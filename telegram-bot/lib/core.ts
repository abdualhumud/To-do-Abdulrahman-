/**
 * Telegram webhook, pairing, inbox, status and setup handlers.
 * Shared plumbing lives in ./infra, reminders and calendar feeds in ./reminders.
 */

import {
  type Env,
  type Result,
  CODE_ALPHABET,
  INBOX_MAX,
  INBOX_TTL_S,
  KEY_ALPHABET,
  KEY_RE,
  PAIR_TTL_S,
  hasStorage,
  json,
  limited,
  missingConfig,
  preflight,
  random,
  readEnv,
  redis,
  safeEqual,
  say,
  tg,
} from "./infra";
import { publicCapabilities } from "./reminders";

export { readEnv };
export type { Env, Result };

// ─── Telegram webhook ─────────────────────────────────────────────────────────

const HELP =
  "TaskFlow bot\n\nSend any message and it becomes a task — one task per line.\n" +
  "Examples:\n• Buy milk tomorrow #personal !high\n• اشتري حليب بكرة\n\n" +
  "Tasks are saved here instantly and appear in TaskFlow the next time you open it.\n" +
  "/unlink disconnects this chat.";

const PAIR_HINT = "To link this chat, open TaskFlow → Settings → Telegram, press Connect, then send the code it shows:\n/link ABCD1234";

function extractCode(text: string): string | null {
  const m = /^\/(?:link|start)(?:@\w+)?\s+(?:link[_-])?([A-Za-z0-9]{6,12})\s*$/.exec(text) ?? /^([A-Za-z0-9]{8})$/.exec(text);
  return m ? m[1].toUpperCase() : null;
}

interface TgMessage {
  from?: { id: number; is_bot?: boolean };
  chat: { id: number; type: string };
  text?: string;
}

async function onMessage(env: Env, msg: TgMessage): Promise<void> {
  if (msg.chat.type !== "private" || !msg.from || msg.from.is_bot) return;
  const chatId = msg.chat.id;
  const text = (msg.text ?? "").trim().slice(0, 4000);
  const inboxKey = (await redis(env, ["GET", `chat:${chatId}`])) as string | null;

  // Not linked yet: only a valid pairing code does anything.
  if (!inboxKey) {
    const code = extractCode(text);
    const key = code ? ((await redis(env, ["GETDEL", `pair:${code}`])) as string | null) : null;
    if (key) {
      await redis(env, ["SET", `chat:${chatId}`, key]);
      await redis(env, ["SET", `linked:${key}`, chatId]);
      await say(env, chatId, "✅ Linked. Send me anything and it becomes a task in TaskFlow — even when the app is closed.");
    } else {
      await say(env, chatId, code ? "That code is wrong or expired. Press Connect again in TaskFlow → Settings → Telegram." : PAIR_HINT);
    }
    return;
  }

  // A linked chat can re-link (app reconnected / new browser). A bare 8-letter word is only
  // treated as a code if it really is a live pairing code, otherwise it is an ordinary task.
  const relinkCode = extractCode(text);
  const newKey = relinkCode ? ((await redis(env, ["GETDEL", `pair:${relinkCode}`])) as string | null) : null;
  if (newKey) {
    const pending = ((await redis(env, ["LRANGE", `inbox:${inboxKey}`, 0, -1])) as string[] | null) ?? [];
    if (pending.length > 0) await redis(env, ["RPUSH", `inbox:${newKey}`, ...pending]);
    await redis(env, ["DEL", `inbox:${inboxKey}`, `linked:${inboxKey}`]);
    await redis(env, ["SET", `chat:${chatId}`, newKey]);
    await redis(env, ["SET", `linked:${newKey}`, chatId]);
    await say(env, chatId, "✅ Linked to the new TaskFlow connection.");
    return;
  }
  if (relinkCode && /^\/(?:link|start)(?:@\w+)?\s/.test(text)) {
    await say(env, chatId, "That code is wrong or expired. Press Connect again in TaskFlow → Settings → Telegram.");
    return;
  }

  if (text.startsWith("/")) {
    if (/^\/(start|help)\b/.test(text)) await say(env, chatId, HELP);
    else if (/^\/unlink\b/.test(text)) {
      await redis(env, ["DEL", `chat:${chatId}`, `linked:${inboxKey}`]);
      await say(env, chatId, "Unlinked. This chat will no longer add tasks.");
    }
    return;
  }
  if (!text) {
    await say(env, chatId, "Only text messages can become tasks.");
    return;
  }

  const key = `inbox:${inboxKey}`;
  await redis(env, ["RPUSH", key, JSON.stringify({ text, at: Date.now() })]);
  await redis(env, ["LTRIM", key, -INBOX_MAX, -1]);
  await redis(env, ["EXPIRE", key, INBOX_TTL_S]);
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).length;
  await say(env, chatId, `✅ Saved${lines > 1 ? ` ${lines} lines` : ""}. It will appear in TaskFlow when you open it.`);
}

export async function handleWebhook(env: Env, headers: Record<string, string | undefined>, body: unknown): Promise<Result> {
  const problem = missingConfig(env);
  if (problem) return { status: 500, body: { ok: false, error: problem } };
  if (!safeEqual(headers["x-telegram-bot-api-secret-token"] ?? "", env.secret)) return { status: 401, body: { ok: false } };
  try {
    const update = body as { message?: TgMessage };
    if (update?.message) await onMessage(env, update.message);
  } catch (e) {
    console.error("webhook error", e); // always 200 so Telegram does not retry forever
  }
  return { status: 200, body: { ok: true } };
}

// ─── App endpoints ────────────────────────────────────────────────────────────

/** POST /api/pair {previousCode?} → { code, inboxKey, bot } — the app then asks the user to send /link CODE. */
export async function handlePair(env: Env, method: string, body?: unknown): Promise<Result> {
  if (method === "OPTIONS") return preflight(env);
  if (method !== "POST") return json(env, 405, { ok: false });
  const problem = missingConfig(env);
  if (problem) return json(env, 503, { ok: false, error: problem });

  if (await limited(env, "pair", 30)) return json(env, 429, { ok: false, error: "Too many attempts, wait a minute" });

  const previous = String((body as { previousCode?: string } | null)?.previousCode ?? "").toUpperCase();
  if (/^[A-Z0-9]{6,12}$/.test(previous)) await redis(env, ["DEL", `pair:${previous}`]); // "New code" revokes the old one

  const code = random(CODE_ALPHABET, 8);
  const inboxKey = random(KEY_ALPHABET, 32);
  await redis(env, ["SET", `pair:${code}`, inboxKey, "EX", PAIR_TTL_S]);
  const me = await tg<{ username?: string }>(env, "getMe");
  return json(env, 200, { ok: true, code, inboxKey, bot: me.username ?? "" });
}

function bearer(headers: Record<string, string | undefined>): string | null {
  const m = /^Bearer\s+(\S+)$/.exec(headers.authorization ?? "");
  return m && KEY_RE.test(m[1]) ? m[1] : null;
}

/** GET → pending messages (not removed). POST {count} → acknowledge, removing the first `count`. */
export async function handleInbox(
  env: Env,
  method: string,
  headers: Record<string, string | undefined>,
  body: unknown,
): Promise<Result> {
  if (method === "OPTIONS") return preflight(env);
  const problem = missingConfig(env);
  if (problem) return json(env, 503, { ok: false, error: problem });
  const key = bearer(headers);
  if (!key) return json(env, 401, { ok: false, error: "Missing or malformed inbox key" });
  const list = `inbox:${key}`;

  if (method === "GET") {
    const raw = ((await redis(env, ["LRANGE", list, 0, 99])) as string[] | null) ?? [];
    const items = raw.flatMap((r) => {
      try {
        const v = JSON.parse(r) as { text: string; at: number };
        return typeof v.text === "string" ? [v] : [];
      } catch {
        return [];
      }
    });
    const linked = Number(await redis(env, ["EXISTS", `linked:${key}`])) === 1;
    return json(env, 200, { ok: true, linked, count: raw.length, items });
  }
  if (method === "POST") {
    const count = Math.min(Math.max(Number((body as { count?: number })?.count ?? 0) | 0, 0), 100);
    if (count > 0) await redis(env, ["LTRIM", list, count, -1]);
    return json(env, 200, { ok: true });
  }
  return json(env, 405, { ok: false });
}

/** Public, secret-free health report: used by the app's "Check connection". */
export async function handleStatus(env: Env, method: string): Promise<Result> {
  if (method === "OPTIONS") return preflight(env);
  // Public endpoint that calls Telegram: bound the cost of abuse (only when Redis is available to count).
  if (hasStorage(env)) {
    try {
      if (await limited(env, "status", 60)) return json(env, 429, { ok: false, error: "Too many requests, wait a minute" });
    } catch {
      /* Redis down: still report below */
    }
  }
  const report: Record<string, unknown> = { ok: true, configured: missingConfig(env) === null, problem: missingConfig(env) };
  if (env.token) {
    try {
      const me = await tg<{ username?: string }>(env, "getMe");
      report.bot = me.username ?? null;
      const info = await tg<{ url?: string; last_error_message?: string }>(env, "getWebhookInfo");
      report.webhookSet = Boolean(info.url);
      report.webhookError = info.last_error_message ?? null;
    } catch (e) {
      report.ok = false;
      report.problem = e instanceof Error ? e.message : "Telegram unreachable";
    }
  }
  if (hasStorage(env)) {
    try {
      report.redis = (await redis(env, ["PING"])) === "PONG";
      if (report.configured) Object.assign(report, await publicCapabilities(env));
    } catch {
      report.redis = false;
    }
  }
  return json(env, 200, report);
}

/** GET /api/setup?key=<TELEGRAM_WEBHOOK_SECRET> → registers this deployment as the bot's webhook. */
export async function handleSetup(env: Env, query: Record<string, string | undefined>, host: string): Promise<Result> {
  const problem = missingConfig(env);
  if (problem) return { status: 500, body: { ok: false, error: problem } };
  if (!query.key || !safeEqual(query.key, env.secret)) return { status: 401, body: { ok: false, error: "Add ?key=<your TELEGRAM_WEBHOOK_SECRET>" } };
  await tg(env, "setWebhook", {
    url: `https://${host}/api/webhook`,
    secret_token: env.secret,
    allowed_updates: JSON.stringify(["message"]),
    drop_pending_updates: "false",
  });
  const info = await tg<{ url?: string }>(env, "getWebhookInfo");
  const me = await tg<{ username?: string }>(env, "getMe");
  return { status: 200, body: { ok: true, bot: me.username, webhook: info.url } };
}
