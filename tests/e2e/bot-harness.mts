// Local stand-ins for Upstash Redis + Telegram Bot API, plus the real telegram-bot/api/*.ts handlers.
// Started by tests/e2e/run.mjs through `npx tsx` (ports: redis 4301, telegram 4302, bot server 4303).
import http from "node:http";
import { pathToFileURL } from "node:url";

const ROOT = decodeURIComponent(new URL("../../telegram-bot", import.meta.url).pathname);
const TOKEN = "123456789:AAHdqTcvCH1vGWJxfSeofSs0K38CIDabcde";
const SECRET = "test-webhook-secret";
process.env.TELEGRAM_BOT_TOKEN = TOKEN;
process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;
process.env.UPSTASH_REDIS_REST_URL = "http://127.0.0.1:4301";
process.env.UPSTASH_REDIS_REST_TOKEN = "redis-token";
process.env.TELEGRAM_API_BASE = "http://127.0.0.1:4302";

const readBody = (req: http.IncomingMessage) =>
  new Promise<string>((resolve) => {
    let d = "";
    req.on("data", (c) => (d += c));
    req.on("end", () => resolve(d));
  });

// ── Fake Upstash Redis ──────────────────────────────────────────────────────
const kv = new Map<string, string>();
const lists = new Map<string, string[]>();
function redisCommand(cmd: (string | number)[]): unknown {
  const [name, ...a] = cmd.map((x, i) => (i === 0 ? String(x).toUpperCase() : x)) as [string, ...(string | number)[]];
  const k = String(a[0]);
  switch (name) {
    case "PING": return "PONG";
    case "GET": return kv.get(k) ?? null;
    case "SET": kv.set(k, String(a[1])); return "OK";
    case "GETDEL": { const v = kv.get(k) ?? null; kv.delete(k); return v; }
    case "DEL": return a.reduce<number>((n, key) => n + Number(kv.delete(String(key)) || lists.delete(String(key))), 0);
    case "EXISTS": return kv.has(k) || lists.has(k) ? 1 : 0;
    case "INCR": { const v = Number(kv.get(k) ?? 0) + 1; kv.set(k, String(v)); return v; }
    case "EXPIRE": return 1;
    case "RPUSH": { const l = lists.get(k) ?? []; l.push(String(a[1])); lists.set(k, l); return l.length; }
    case "LRANGE": { const l = lists.get(k) ?? []; const s = Number(a[1]); let e = Number(a[2]); if (e < 0) e = l.length + e; return l.slice(s < 0 ? l.length + s : s, e + 1); }
    case "LTRIM": { const l = lists.get(k) ?? []; let s = Number(a[1]); let e = Number(a[2]); if (s < 0) s = Math.max(l.length + s, 0); if (e < 0) e = l.length + e; const out = l.slice(s, e + 1); out.length ? lists.set(k, out) : lists.delete(k); return "OK"; }
    default: throw new Error(`fake redis: unsupported ${name}`);
  }
}
http.createServer(async (req, res) => {
  const auth = req.headers.authorization;
  const body = JSON.parse((await readBody(req)) || "[]");
  res.setHeader("content-type", "application/json");
  if (auth !== "Bearer redis-token") return void res.writeHead(401).end(JSON.stringify({ error: "WRONGPASS" }));
  try { res.end(JSON.stringify({ result: redisCommand(body) })); } catch (e) { res.end(JSON.stringify({ error: String(e) })); }
}).listen(4301);

// ── Fake Telegram Bot API (+ test controls) ─────────────────────────────────
// The webhook is pre-registered, as after a successful /api/setup.
let webhook: { url: string; secret: string } | null = { url: "https://taskflow-bot.vercel.app/api/webhook", secret: SECRET };
const sent: { chat: number; text: string }[] = [];
let updateId = 1;
http.createServer(async (req, res) => {
  const url = new URL(req.url!, "http://x");
  const raw = await readBody(req);
  res.setHeader("content-type", "application/json");
  const reply = (status: number, payload: unknown) => res.writeHead(status).end(JSON.stringify(payload));

  if (url.pathname === "/__sent") return reply(200, sent);
  if (url.pathname === "/__clear-sent") { sent.length = 0; return reply(200, {}); }
  if (url.pathname === "/__reset") {
    sent.length = 0; kv.clear(); lists.clear();
    webhook = { url: "https://taskflow-bot.vercel.app/api/webhook", secret: SECRET };
    return reply(200, {});
  }
  if (url.pathname === "/__push") {
    const { chat, text, secret } = JSON.parse(raw);
    const r = await fetch("http://127.0.0.1:4303/api/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": secret ?? webhook?.secret ?? "" },
      body: JSON.stringify({ update_id: updateId++, message: { message_id: 1, from: { id: chat, is_bot: false }, chat: { id: chat, type: "private" }, text } }),
    });
    return reply(200, { status: r.status });
  }
  const m = url.pathname.match(/^\/bot([^/]+)\/(\w+)$/);
  if (!m) return reply(404, { ok: false });
  const [, token, method] = m;
  if (token !== TOKEN) return reply(401, { ok: false, error_code: 401, description: "Unauthorized" });
  const p = new URLSearchParams(raw);
  if (method === "getMe") return reply(200, { ok: true, result: { id: 1, is_bot: true, username: "taskflow_test_bot" } });
  if (method === "setWebhook") { webhook = { url: p.get("url")!, secret: p.get("secret_token")! }; return reply(200, { ok: true, result: true }); }
  if (method === "getWebhookInfo") return reply(200, { ok: true, result: { url: webhook?.url ?? "" } });
  if (method === "sendMessage") { sent.push({ chat: Number(p.get("chat_id")), text: p.get("text")! }); return reply(200, { ok: true, result: {} }); }
  return reply(200, { ok: true, result: true });
}).listen(4302);

// ── The real Vercel handlers behind a minimal Vercel-style req/res ──────────
http.createServer(async (req, res) => {
  const url = new URL(req.url!, "http://x");
  const m = url.pathname.match(/^\/api\/(\w+)$/);
  if (!m) return void res.writeHead(404).end("not found");
  const mod = await import(pathToFileURL(`${ROOT}/api/${m[1]}.ts`).href + `?t=${Date.now()}`);
  const raw = await readBody(req);
  const vreq: any = Object.assign(req, {
    query: Object.fromEntries(url.searchParams),
    body: raw && (req.headers["content-type"] ?? "").includes("json") ? JSON.parse(raw) : raw || undefined,
  });
  const vres: any = res;
  vres.status = (c: number) => { res.statusCode = c; return vres; };
  vres.json = (b: unknown) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(b)); };
  await mod.default(vreq, vres);
}).listen(4303, () => console.log("harness ready"));
