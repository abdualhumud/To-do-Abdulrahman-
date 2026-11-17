/**
 * TaskFlow always-on Telegram server (Vercel).
 *
 * The bot answers instantly 24/7; tasks wait in a small Redis inbox until the web app
 * (which keeps its data in the browser) collects them. The server never reads or stores
 * the user's task list — only raw message text until it is collected.
 *
 * Env: TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, UPSTASH_REDIS_REST_URL/TOKEN
 *      (or KV_REST_API_URL/TOKEN), optional APP_ORIGIN, TELEGRAM_API_BASE (tests).
 */

export interface Env {
  token: string;
  secret: string;
  redisUrl: string;
  redisToken: string;
  appOrigin: string;
  apiBase: string;
}

export function readEnv(source: Record<string, string | undefined> = process.env): Env {
  return {
    token: source.TELEGRAM_BOT_TOKEN ?? "",
    secret: source.TELEGRAM_WEBHOOK_SECRET ?? "",
    redisUrl: source.UPSTASH_REDIS_REST_URL ?? source.KV_REST_API_URL ?? "",
    redisToken: source.UPSTASH_REDIS_REST_TOKEN ?? source.KV_REST_API_TOKEN ?? "",
    appOrigin: source.APP_ORIGIN ?? "*",
    apiBase: source.TELEGRAM_API_BASE ?? "https://api.telegram.org",
  };
}

export interface Result {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

// ─── Redis (Upstash REST: a command array POSTed to the base URL) ─────────────

async function redis(env: Env, command: (string | number)[]): Promise<unknown> {
  const res = await fetch(env.redisUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.redisToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
  const json = (await res.json()) as { result?: unknown; error?: string };
  if (json.error) throw new Error(`redis: ${json.error}`);
  return json.result;
}

// ─── Telegram ─────────────────────────────────────────────────────────────────

async function tg<T>(env: Env, method: string, params: Record<string, string | number> = {}): Promise<T> {
  const res = await fetch(`${env.apiBase}/bot${env.token}/${method}`, {
    method: "POST",
    body: new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])),
  });
  const json = (await res.json()) as { ok: boolean; result: T; description?: string };
  if (!json.ok) throw new Error(`telegram ${method}: ${json.description ?? res.status}`);
  return json.result;
}

async function say(env: Env, chatId: number, text: string): Promise<void> {
  try {
    await tg(env, "sendMessage", { chat_id: chatId, text });
  } catch (e) {
    console.error("sendMessage failed", e);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const KEY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
const PAIR_TTL_S = 15 * 60;
const INBOX_TTL_S = 30 * 24 * 3600;
const INBOX_MAX = 500;
const KEY_RE = /^[A-Za-z0-9]{32}$/;

function random(alphabet: string, length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

function cors(env: Env): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": env.appOrigin,
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
  };
}

function json(env: Env, status: number, body: unknown): Result {
  return { status, body, headers: cors(env) };
}

const preflight = (env: Env): Result => ({ status: 204, body: null, headers: cors(env) });

function missingConfig(env: Env): string | null {
  if (!env.token) return "TELEGRAM_BOT_TOKEN is not set";
  if (!env.secret) return "TELEGRAM_WEBHOOK_SECRET is not set";
  if (!env.redisUrl || !env.redisToken) return "Redis is not connected (add Upstash Redis to the project)";
  return null;
}

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
  if (headers["x-telegram-bot-api-secret-token"] !== env.secret) return { status: 401, body: { ok: false } };
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

  const minute = Math.floor(Date.now() / 60_000);
  const used = Number(await redis(env, ["INCR", `rate:pair:${minute}`]));
  if (used === 1) await redis(env, ["EXPIRE", `rate:pair:${minute}`, 120]);
  if (used > 30) return json(env, 429, { ok: false, error: "Too many attempts, wait a minute" });

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
  if (env.redisUrl && env.redisToken) {
    try {
      report.redis = (await redis(env, ["PING"])) === "PONG";
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
  if (!query.key || query.key !== env.secret) return { status: 401, body: { ok: false, error: "Add ?key=<your TELEGRAM_WEBHOOK_SECRET>" } };
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
