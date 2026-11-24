/**
 * TaskFlow always-on Telegram server (Vercel).
 *
 * The bot answers instantly 24/7; tasks wait in a small Redis inbox until the web app
 * (which keeps its data in the browser) collects them. The server never reads or stores
 * the user's task list — only raw message text until it is collected.
 *
 * Env: TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, UPSTASH_REDIS_REST_URL/TOKEN
 *      (or KV_REST_API_URL/TOKEN). Optional: APP_ORIGIN, CRON_SECRET, RESEND_API_KEY,
 *      REMINDER_EMAIL_TO, EMAIL_FROM, TELEGRAM_API_BASE / RESEND_API_BASE (tests).
 */

/** Storage backend. Upstash REST is the default; the Cloudflare Worker injects a Durable Object. */
export interface Store {
  run(command: (string | number)[]): Promise<unknown>;
  pipeline(commands: (string | number)[][]): Promise<unknown[]>;
}

export interface Env {
  store?: Store;
  token: string;
  secret: string;
  redisUrl: string;
  redisToken: string;
  appOrigin: string;
  apiBase: string;
  cronSecret: string;
  resendKey: string;
  emailTo: string;
  emailFrom: string;
  resendBase: string;
  /** Tests only: lets requests set the clock and use /__redis and /__reset. Never set in production. */
  testMode: boolean;
  /** How many sync vaults this server will host (each person/household is one vault). */
  maxVaults: number;
  /** Optional: the only Telegram chat id allowed to use this server (otherwise the first chat that links becomes the owner). */
  ownerChatId: number;
}

export function readEnv(source: Record<string, string | undefined> = process.env): Env {
  return {
    token: source.TELEGRAM_BOT_TOKEN ?? "",
    secret: source.TELEGRAM_WEBHOOK_SECRET ?? "",
    redisUrl: source.UPSTASH_REDIS_REST_URL ?? source.KV_REST_API_URL ?? "",
    redisToken: source.UPSTASH_REDIS_REST_TOKEN ?? source.KV_REST_API_TOKEN ?? "",
    appOrigin: source.APP_ORIGIN ?? "*",
    apiBase: source.TELEGRAM_API_BASE ?? "https://api.telegram.org",
    cronSecret: source.CRON_SECRET ?? source.TELEGRAM_WEBHOOK_SECRET ?? "",
    resendKey: source.RESEND_API_KEY ?? "",
    emailTo: source.REMINDER_EMAIL_TO ?? "",
    emailFrom: source.EMAIL_FROM ?? "TaskFlow <onboarding@resend.dev>",
    resendBase: source.RESEND_API_BASE ?? "https://api.resend.com",
    testMode: source.ALLOW_TEST_CLOCK === "1",
    maxVaults: Math.max(1, Number(source.MAX_VAULTS) || 5),
    ownerChatId: Number(source.OWNER_CHAT_ID) || 0,
  };
}

export interface Result {
  status: number;
  body: unknown; // JSON-serialisable, or a string sent as-is with `contentType`
  headers?: Record<string, string>;
  contentType?: string;
}

// ─── Redis (Upstash REST: a command array POSTed to the base URL) ─────────────

export async function redis(env: Env, command: (string | number)[]): Promise<unknown> {
  if (env.store) return env.store.run(command);
  const res = await fetch(env.redisUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.redisToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
  const json = (await res.json()) as { result?: unknown; error?: string };
  if (json.error) throw new Error(`redis: ${json.error}`);
  return json.result;
}

/** Several Redis commands in one round trip (Upstash REST /pipeline). */
export async function pipeline(env: Env, commands: (string | number)[][]): Promise<unknown[]> {
  if (env.store) return env.store.pipeline(commands);
  const results: unknown[] = [];
  for (let i = 0; i < commands.length; i += 200) {
    const res = await fetch(`${env.redisUrl}/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.redisToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(commands.slice(i, i + 200)),
    });
    const out = (await res.json()) as { result?: unknown; error?: string }[];
    const failed = Array.isArray(out) ? out.find((r) => r.error) : null;
    if (!Array.isArray(out) || failed) throw new Error(`redis pipeline: ${failed?.error ?? "bad reply"}`);
    results.push(...out.map((r) => r.result));
  }
  return results;
}

// ─── Telegram ─────────────────────────────────────────────────────────────────

export async function tg<T>(env: Env, method: string, params: Record<string, string | number> = {}): Promise<T> {
  const res = await fetch(`${env.apiBase}/bot${env.token}/${method}`, {
    method: "POST",
    body: new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])),
  });
  const json = (await res.json()) as { ok: boolean; result: T; description?: string };
  if (!json.ok) throw new Error(`telegram ${method}: ${json.description ?? res.status}`);
  return json.result;
}

export async function say(env: Env, chatId: number, text: string): Promise<void> {
  try {
    await tg(env, "sendMessage", { chat_id: chatId, text });
  } catch (e) {
    console.error("sendMessage failed", e);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const KEY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
export const PAIR_TTL_S = 15 * 60;
export const INBOX_TTL_S = 30 * 24 * 3600;
export const INBOX_MAX = 500;
export const KEY_RE = /^[A-Za-z0-9]{32}$/;

export function random(alphabet: string, length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

/** Constant-time string comparison, so secrets can't be guessed from response timing. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Fixed-window limiter in Redis; returns true when the call should be refused. */
export async function limited(env: Env, bucket: string, max: number, windowS = 60): Promise<boolean> {
  const key = `rate:${bucket}:${Math.floor(Date.now() / (windowS * 1000))}`;
  const used = Number(await redis(env, ["INCR", key]));
  if (used === 1) await redis(env, ["EXPIRE", key, windowS * 2]);
  return used > max;
}

/** The caller's address as set by the platform (Cloudflare / Vercel) — never a client-supplied X-Forwarded-For. */
export function clientIp(headers: Record<string, string | undefined>): string {
  const ip = headers["cf-connecting-ip"] ?? headers["x-vercel-forwarded-for"] ?? headers["x-real-ip"] ?? "";
  return /^[0-9a-fA-F:.]{3,45}$/.test(ip) ? ip : "unknown";
}

/** Per-client limit (so one abuser cannot lock everyone out) plus a much larger global backstop. */
export async function limitedByIp(env: Env, bucket: string, headers: Record<string, string | undefined>, perIp: number, windowS = 60): Promise<boolean> {
  if (await limited(env, `${bucket}:ip:${clientIp(headers)}`, perIp, windowS)) return true;
  return limited(env, `${bucket}:all`, perIp * 20, windowS);
}

/** A key may use account features only after its Telegram chat has been linked (which only the owner can do). */
export async function isLinkedKey(env: Env, key: string): Promise<boolean> {
  return Number(await redis(env, ["EXISTS", `linked:${key}`])) === 1;
}

export function cors(env: Env): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": env.appOrigin,
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Max-Age": "86400",
  };
}

export function json(env: Env, status: number, body: unknown): Result {
  return { status, body, headers: cors(env) };
}

export const preflight = (env: Env): Result => ({ status: 204, body: null, headers: cors(env) });

export function hasStorage(env: Env): boolean {
  return Boolean(env.store || (env.redisUrl && env.redisToken));
}

export function missingConfig(env: Env): string | null {
  if (!env.token) return "TELEGRAM_BOT_TOKEN is not set";
  if (!env.secret) return "TELEGRAM_WEBHOOK_SECRET is not set";
  if (!hasStorage(env)) return "Storage is not connected (Upstash Redis for Vercel, or the Durable Object for Cloudflare)";
  return null;
}

