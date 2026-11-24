/**
 * Reminders (Telegram / email / phone push) and the subscribable calendar feed.
 *
 * The web app keeps its data in the browser. When the user opts in, it pushes a copy of its *dated*
 * open tasks here (PUT /api/reminders, replace-all). The server schedules reminders and serves the
 * calendar feed from that copy; nothing else about the user's tasks is stored.
 *
 * Redis layout (all keyed by the app's secret inboxKey):
 *   rem:<key>    hash id → reminder JSON          cal:<key>   hash id → calendar item JSON
 *   state:<key>  hash id → last delivered time    due         zset "<key>|<id>" scored by next fire time
 *   push:<key>   hash endpoint → push subscription
 *   feed:<fk>    → key        feedof:<key> → fk   vapid:keys  → VAPID key pair (generated once)
 */

import {
  type Env,
  type Result,
  KEY_ALPHABET,
  KEY_RE,
  isLinkedKey,
  json,
  limited,
  limitedByIp,
  missingConfig,
  pipeline,
  preflight,
  random,
  redis,
  safeEqual,
  say,
} from "./infra";
import { REPEAT_LABELS, formatZoned, isRepeat, isValidTimeZone, nextFire, type Repeat } from "./recurrence";
import { buildCalendar, type CalendarItem } from "./ics";
import { generateVapidKeys, sendWebPush, type PushSubscription, type Vapid } from "./webpush";

export type { PushSubscription, Vapid };

export type Channel = "telegram" | "email" | "push";
const CHANNELS: Channel[] = ["telegram", "email", "push"];
const MAX_ITEMS = 300;
const MAX_DEVICES = 10;
const DATA_TTL_S = 90 * 24 * 3600;
const DAY = 86_400_000;

interface StoredItem {
  id: string;
  title: string;
  description: string | null;
  due_date: string | null;
  reminder_at: number | null;
  repeat: Repeat;
  channels: Channel[];
  priority?: "low" | "medium" | "high" | "urgent";
  category: string | null;
  tz: string;
  appUrl: string;
}

// ─── Input validation ─────────────────────────────────────────────────────────

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

export function validateItems(raw: unknown, now: number, tzRaw: unknown, appUrlRaw: unknown): StoredItem[] {
  if (!Array.isArray(raw)) throw new Error("items must be an array");
  const tz = typeof tzRaw === "string" && isValidTimeZone(tzRaw) ? tzRaw : "UTC";
  const appUrl = /^https:\/\/[^\s]{1,300}$/.test(String(appUrlRaw)) ? String(appUrlRaw) : "";
  const seen = new Set<string>();
  const items: StoredItem[] = [];

  for (const r of raw.slice(0, MAX_ITEMS)) {
    const o = (r ?? {}) as Record<string, unknown>;
    const id = str(o.id, 64);
    const title = str(o.title, 300);
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || !title || seen.has(id)) continue;
    seen.add(id);

    const due = typeof o.due_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.due_date) ? o.due_date : null;
    const at = Number(o.reminder_at);
    const reminder = Number.isInteger(at) && at > now - 30 * DAY && at < now + 5 * 365 * DAY ? at : null;
    if (!due && !reminder) continue;

    const channels = Array.isArray(o.channels) ? CHANNELS.filter((c) => (o.channels as unknown[]).includes(c)) : [];
    const priority = ["low", "medium", "high", "urgent"].includes(String(o.priority)) ? (o.priority as StoredItem["priority"]) : undefined;
    items.push({
      id,
      title,
      description: str(o.description, 1000) || null,
      due_date: due,
      reminder_at: reminder,
      repeat: isRepeat(o.repeat) ? o.repeat : "none",
      channels,
      priority,
      category: str(o.category, 50) || null,
      tz,
      appUrl,
    });
  }
  return items;
}

// ─── Sync (app → server) ──────────────────────────────────────────────────────

export interface SyncSummary {
  reminders: number;
  calendar: number;
  nextFire: number | null;
}

export async function syncItems(env: Env, key: string, body: unknown, now: number): Promise<SyncSummary> {
  const b = (body ?? {}) as { items?: unknown; tz?: unknown; appUrl?: unknown };
  // Only our own site's address may be embedded in messages (no attacker-chosen links in mail sent from the owner's sender).
  const appUrl = typeof b.appUrl === "string" && (env.appOrigin === "*" || b.appUrl.startsWith(env.appOrigin)) ? b.appUrl : "";
  const items = validateItems(b.items, now, b.tz, appUrl);

  const [remIds, calIds, stateFlat] = (await pipeline(env, [
    ["HKEYS", `rem:${key}`],
    ["HKEYS", `cal:${key}`],
    ["HGETALL", `state:${key}`],
  ])) as [string[] | null, string[] | null, string[] | null];
  const last = new Map<string, number>();
  const flat = stateFlat ?? [];
  for (let i = 0; i + 1 < flat.length; i += 2) last.set(flat[i], Number(flat[i + 1]));

  const keepRem = new Set<string>();
  const keepCal = new Set<string>();
  const commands: (string | number)[][] = [];
  let soonest: number | null = null;

  for (const item of items) {
    const member = `${key}|${item.id}`;
    keepCal.add(item.id);
    commands.push(["HSET", `cal:${key}`, item.id, JSON.stringify(item)]);

    if (item.reminder_at && item.channels.length > 0) {
      keepRem.add(item.id);
      commands.push(["HSET", `rem:${key}`, item.id, JSON.stringify(item)]);
      const fire = nextFire({ anchor: item.reminder_at, repeat: item.repeat, tz: item.tz }, last.get(item.id) ?? null, now);
      if (fire === null) commands.push(["ZREM", "due", member]);
      else {
        commands.push(["ZADD", "due", fire, member]);
        soonest = soonest === null ? fire : Math.min(soonest, fire);
      }
    } else {
      commands.push(["HDEL", `rem:${key}`, item.id], ["ZREM", "due", member]);
    }
  }

  for (const id of remIds ?? []) {
    if (!keepRem.has(id)) commands.push(["HDEL", `rem:${key}`, id], ["ZREM", "due", `${key}|${id}`], ["HDEL", `state:${key}`, id]);
  }
  for (const id of calIds ?? []) if (!keepCal.has(id)) commands.push(["HDEL", `cal:${key}`, id]);
  for (const k of ["rem", "cal", "state"]) commands.push(["EXPIRE", `${k}:${key}`, DATA_TTL_S]);

  await pipeline(env, commands);
  return { reminders: keepRem.size, calendar: keepCal.size, nextFire: soonest };
}

// ─── Delivery ─────────────────────────────────────────────────────────────────

export interface Deps {
  sendPush?: (sub: PushSubscription, payload: string, vapid: Vapid, subject: string) => Promise<void>;
}
export interface Delivery {
  channel: Channel;
  ok: boolean;
  detail: string;
}

function messageFor(item: StoredItem, fireAt: number): { title: string; text: string } {
  const lines = [`⏰ ${item.title}`, `🗓 ${formatZoned(fireAt, item.tz)}`];
  if (item.repeat !== "none") lines.push(`🔁 ${REPEAT_LABELS[item.repeat]}`);
  if (item.description) lines.push("", item.description);
  if (item.appUrl) lines.push("", item.appUrl);
  return { title: `⏰ ${item.title}`, text: lines.join("\n") };
}

export function maskEmail(email: string): string {
  const [name, domain] = email.split("@");
  return name && domain ? `${name[0]}${"*".repeat(Math.max(name.length - 1, 1))}@${domain}` : "";
}

async function sendEmail(env: Env, subject: string, text: string): Promise<void> {
  if (!env.resendKey || !env.emailTo) throw new Error("Email is not configured (set RESEND_API_KEY and REMINDER_EMAIL_TO)");
  const res = await fetch(`${env.resendBase}/emails`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.emailFrom, to: [env.emailTo], subject, text }),
  });
  if (!res.ok) {
    const detail = ((await res.json().catch(() => null)) as { message?: string } | null)?.message;
    throw new Error(`Email provider refused: ${detail ?? res.status}`);
  }
}

/** VAPID keys are generated once and kept in the store, so no manual key setup is needed. */
export async function getVapid(env: Env): Promise<Vapid> {
  const existing = (await redis(env, ["GET", "vapid:keys"])) as string | null;
  if (existing) return JSON.parse(existing) as Vapid;
  const keys = await generateVapidKeys();
  await redis(env, ["SET", "vapid:keys", JSON.stringify(keys), "NX"]);
  return JSON.parse(((await redis(env, ["GET", "vapid:keys"])) as string | null) ?? JSON.stringify(keys)) as Vapid;
}

async function deliver(env: Env, key: string, item: StoredItem, fireAt: number, deps: Deps, only?: Channel): Promise<Delivery[]> {
  const { title, text } = messageFor(item, fireAt);
  const channels = only ? [only] : item.channels;

  const run = async (channel: Channel): Promise<Delivery> => {
    try {
      if (channel === "telegram") {
        const chat = Number(await redis(env, ["GET", `linked:${key}`]));
        if (!chat) throw new Error("Telegram chat is not linked");
        await say(env, chat, text);
        return { channel, ok: true, detail: "sent" };
      }
      if (channel === "email") {
        await sendEmail(env, title, text);
        return { channel, ok: true, detail: `sent to ${maskEmail(env.emailTo)}` };
      }
      const flat = ((await redis(env, ["HGETALL", `push:${key}`])) as string[] | null) ?? [];
      if (flat.length === 0) throw new Error("No phone is registered for notifications");
      const vapid = await getVapid(env);
      const subject = env.appOrigin.startsWith("https://") ? env.appOrigin : "mailto:taskflow@example.com"; // never expose the owner's address to push services
      const send = deps.sendPush ?? ((sub, payload, vapid, subject) => sendWebPush(sub, payload, vapid, subject));
      const payload = JSON.stringify({ title, body: `${formatZoned(fireAt, item.tz)}${item.description ? `\n${item.description}` : ""}`, tag: item.id, url: item.appUrl });
      let delivered = 0;
      for (let i = 0; i + 1 < flat.length; i += 2) {
        try {
          await send(JSON.parse(flat[i + 1]) as PushSubscription, payload, vapid, subject);
          delivered++;
        } catch (e) {
          const code = (e as { statusCode?: number }).statusCode;
          if (code === 404 || code === 410) await redis(env, ["HDEL", `push:${key}`, flat[i]]); // device unsubscribed
        }
      }
      if (delivered === 0) throw new Error("Push service refused every device");
      return { channel, ok: true, detail: `${delivered} device(s)` };
    } catch (e) {
      return { channel, ok: false, detail: e instanceof Error ? e.message : "failed" };
    }
  };
  return Promise.all(channels.map(run));
}

// ─── Scheduler (called by cron) ───────────────────────────────────────────────

export interface RunSummary {
  due: number;
  fired: { id: string; deliveries: Delivery[] }[];
}

export async function runDue(env: Env, now: number, deps: Deps = {}): Promise<RunSummary> {
  const flat = ((await redis(env, ["ZRANGEBYSCORE", "due", "-inf", now, "WITHSCORES", "LIMIT", 0, 100])) as string[] | null) ?? [];
  const summary: RunSummary = { due: flat.length / 2, fired: [] };

  for (let i = 0; i + 1 < flat.length; i += 2) {
    const member = flat[i];
    const fireAt = Number(flat[i + 1]);
    // ZREM succeeds for exactly one of several overlapping cron runs, so nothing is sent twice.
    if (Number(await redis(env, ["ZREM", "due", member])) !== 1) continue;
    const [key, id] = member.split("|");
    const raw = (await redis(env, ["HGET", `rem:${key}`, id])) as string | null;
    if (!raw) continue;
    const item = JSON.parse(raw) as StoredItem;

    const deliveries = await deliver(env, key, item, fireAt, deps);
    summary.fired.push({ id, deliveries });
    await redis(env, ["HSET", `state:${key}`, id, fireAt]);
    const next = nextFire({ anchor: item.reminder_at ?? fireAt, repeat: item.repeat, tz: item.tz }, fireAt, now);
    if (next !== null) await redis(env, ["ZADD", "due", next, member]);
  }
  return summary;
}

// ─── Test messages ────────────────────────────────────────────────────────────

export async function sendTest(env: Env, key: string, channel: Channel, now: number, deps: Deps = {}): Promise<Delivery> {
  const item: StoredItem = {
    id: "test",
    title: "TaskFlow test reminder",
    description: "If you can read this, this channel works.",
    due_date: null,
    reminder_at: now,
    repeat: "none",
    channels: [channel],
    category: null,
    tz: "UTC",
    appUrl: "",
  };
  return (await deliver(env, key, item, now, deps, channel))[0];
}

// ─── HTTP handlers ────────────────────────────────────────────────────────────

function bearerKey(headers: Record<string, string | undefined>): string | null {
  const m = /^Bearer\s+(\S+)$/.exec(headers.authorization ?? "");
  return m && KEY_RE.test(m[1]) ? m[1] : null;
}

/** Push services we deliver to. Anything else would let a caller make this server POST to arbitrary hosts. */
const PUSH_HOSTS = /^(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[\w-]+\.push\.services\.mozilla\.com|[\w.-]+\.push\.apple\.com|[\w.-]+\.notify\.windows\.com)$/;
export function pushEndpointAllowed(url: string, testMode: boolean): boolean {
  if (testMode && /^http:\/\/127\.0\.0\.1:\d+\/\S*$/.test(url)) return true;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && !u.username && !u.password && !u.port && PUSH_HOSTS.test(u.hostname) && url.length <= 500;
  } catch {
    return false;
  }
}

/** Authenticates the caller: a well-formed key whose Telegram chat was linked by the owner. */
async function authorize(env: Env, headers: Record<string, string | undefined>): Promise<{ key: string } | Result> {
  const key = bearerKey(headers);
  if (!key) return json(env, 401, { ok: false, error: "Missing or malformed key" });
  if (!(await isLinkedKey(env, key))) return json(env, 401, { ok: false, error: "This key is not linked. Connect Telegram in TaskFlow → Settings first." });
  return { key };
}

/** PUT = sync dated tasks; POST ?test=<channel> = send a test message. */
export async function handleReminders(
  env: Env,
  method: string,
  headers: Record<string, string | undefined>,
  query: Record<string, string | undefined>,
  body: unknown,
  now: number,
  deps: Deps = {},
): Promise<Result> {
  if (method === "OPTIONS") return preflight(env);
  const problem = missingConfig(env);
  if (problem) return json(env, 503, { ok: false, error: problem });
  if (await limitedByIp(env, "rem", headers, 120)) return json(env, 429, { ok: false, error: "Too many requests" });
  const auth = await authorize(env, headers);
  if (!("key" in auth)) return auth;
  const key = auth.key;

  if (method === "PUT") {
    try {
      return json(env, 200, { ok: true, ...(await syncItems(env, key, body, now)) });
    } catch (e) {
      return json(env, 400, { ok: false, error: e instanceof Error ? e.message : "Bad request" });
    }
  }
  if (method === "POST" && CHANNELS.includes(query.test as Channel)) {
    if (await limited(env, `test:${query.test}`, 5, 3600)) return json(env, 429, { ok: false, error: "Test messages are limited to 5 per hour" });
    const d = await sendTest(env, key, query.test as Channel, now, deps);
    return json(env, 200, { ok: true, delivered: d.ok, channel: d.channel, detail: d.detail });
  }
  return json(env, 405, { ok: false });
}

/** POST {subscription} registers a phone; DELETE {endpoint} removes it. */
export async function handlePush(
  env: Env,
  method: string,
  headers: Record<string, string | undefined>,
  body: unknown,
): Promise<Result> {
  if (method === "OPTIONS") return preflight(env);
  const problem = missingConfig(env);
  if (problem) return json(env, 503, { ok: false, error: problem });
  if (await limitedByIp(env, "push", headers, 60)) return json(env, 429, { ok: false, error: "Too many requests" });
  const auth = await authorize(env, headers);
  if (!("key" in auth)) return auth;
  const key = auth.key;

  if (method === "POST") {
    const sub = (body as { subscription?: PushSubscription } | null)?.subscription;
    const valid = sub && pushEndpointAllowed(sub.endpoint ?? "", env.testMode) && sub.keys?.p256dh && sub.keys?.auth;
    if (!valid) return json(env, 400, { ok: false, error: "Invalid subscription" });
    const count = Number(await redis(env, ["HLEN", `push:${key}`]));
    if (count >= MAX_DEVICES) return json(env, 400, { ok: false, error: "Too many devices" });
    await redis(env, ["HSET", `push:${key}`, sub.endpoint, JSON.stringify({ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } })]);
    return json(env, 200, { ok: true });
  }
  if (method === "DELETE") {
    const endpoint = String((body as { endpoint?: string } | null)?.endpoint ?? "");
    if (endpoint) await redis(env, ["HDEL", `push:${key}`, endpoint]);
    return json(env, 200, { ok: true });
  }
  return json(env, 405, { ok: false });
}

/** GET with the cron secret (Bearer header or ?key=) runs everything that is due. */
export async function handleCron(
  env: Env,
  headers: Record<string, string | undefined>,
  query: Record<string, string | undefined>,
  now: number,
  deps: Deps = {},
): Promise<Result> {
  const problem = missingConfig(env);
  if (problem) return { status: 500, body: { ok: false, error: problem } };
  const given = /^Bearer\s+(\S+)$/.exec(headers.authorization ?? "")?.[1] ?? query.key ?? "";
  if (!env.cronSecret || !safeEqual(given, env.cronSecret)) return { status: 401, body: { ok: false } };
  const summary = await runDue(env, now, deps);
  return { status: 200, body: { ok: true, due: summary.due, fired: summary.fired.length, details: summary.fired } };
}

// ─── Calendar feed ────────────────────────────────────────────────────────────

/** POST (Bearer key) → the private feed URL for this user, created on first use. */
export async function handleFeedCreate(env: Env, headers: Record<string, string | undefined>, host: string): Promise<Result> {
  const problem = missingConfig(env);
  if (problem) return json(env, 503, { ok: false, error: problem });
  if (await limitedByIp(env, "feedmk", headers, 30)) return json(env, 429, { ok: false, error: "Too many requests" });
  const auth = await authorize(env, headers);
  if (!("key" in auth)) return auth;
  const key = auth.key;
  let fk = (await redis(env, ["GET", `feedof:${key}`])) as string | null;
  if (!fk) {
    fk = random(KEY_ALPHABET, 32);
    await pipeline(env, [["SET", `feed:${fk}`, key], ["SET", `feedof:${key}`, fk]]);
  }
  return json(env, 200, { ok: true, url: `https://${host}/api/feed?k=${fk}` });
}

/** GET ?k=<feedKey> → text/calendar. The URL itself is the secret (calendar apps can't send headers). */
export async function handleFeed(env: Env, feedKey: string, now: number): Promise<Result> {
  const text = (status: number, body: string): Result => ({ status, body, contentType: "text/plain; charset=utf-8" });
  if (missingConfig(env) || !KEY_RE.test(feedKey)) return text(404, "Not found");
  if (await limited(env, "feed", 240)) return text(429, "Too many requests");
  const key = (await redis(env, ["GET", `feed:${feedKey}`])) as string | null;
  if (!key) return text(404, "Not found");

  const flat = ((await redis(env, ["HGETALL", `cal:${key}`])) as string[] | null) ?? [];
  const items: CalendarItem[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) {
    const o = JSON.parse(flat[i + 1]) as StoredItem;
    items.push({ id: o.id, title: o.title, description: o.description, due_date: o.due_date, reminder_at: o.reminder_at, repeat: o.repeat, tz: o.tz, priority: o.priority, category: o.category, alarm: true });
  }
  return {
    status: 200,
    body: buildCalendar(items, now, "TaskFlow"),
    contentType: "text/calendar; charset=utf-8",
    headers: { "Cache-Control": "no-cache, max-age=0", "Content-Disposition": 'inline; filename="taskflow.ics"' },
  };
}

// ─── Capabilities for /api/status ─────────────────────────────────────────────

export async function publicCapabilities(env: Env): Promise<Record<string, unknown>> {
  const caps: Record<string, unknown> = {
    email: { configured: Boolean(env.resendKey && env.emailTo), to: env.emailTo ? maskEmail(env.emailTo) : null },
    reminders: true,
    sync: true,
  };
  try {
    caps.vapidPublicKey = (await getVapid(env)).publicKey;
  } catch {
    caps.vapidPublicKey = null;
  }
  return caps;
}
