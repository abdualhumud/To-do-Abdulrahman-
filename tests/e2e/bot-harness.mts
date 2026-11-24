// Test harness: fake Redis (Upstash REST) + fake Telegram Bot API + fake Resend + the real
// telegram-bot/api/*.ts handlers. Started by tests/e2e/run.mjs through `npx tsx`.
// Ports: redis 4301, telegram 4302 (+ test controls), bot server 4303, resend 4304.
import http from "node:http";
import { pathToFileURL } from "node:url";
import { FakeRedis, FakeResend, FakeTelegram } from "../unit/helpers/fakes.ts";

const ROOT = decodeURIComponent(new URL("../../telegram-bot", import.meta.url).pathname);
const TOKEN = "123456789:AAHdqTcvCH1vGWJxfSeofSs0K38CIDabcde";
const SECRET = "test-webhook-secret";
process.env.TELEGRAM_BOT_TOKEN = TOKEN;
process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;
process.env.UPSTASH_REDIS_REST_URL = "http://127.0.0.1:4301";
process.env.UPSTASH_REDIS_REST_TOKEN = "redis-token";
process.env.TELEGRAM_API_BASE = "http://127.0.0.1:4302";
process.env.RESEND_API_KEY = "re_test";
process.env.RESEND_API_BASE = "http://127.0.0.1:4304";
process.env.REMINDER_EMAIL_TO = "owner@elm.sa";
process.env.CRON_SECRET = "cron-secret";

const WEBHOOK = { url: "https://taskflow-bot.vercel.app/api/webhook", secret: SECRET };
const redis = new FakeRedis();
const telegram = new FakeTelegram(TOKEN);
const resend = new FakeResend();
telegram.webhookUrl = WEBHOOK.url;
const sent = telegram.sent;

const readBody = (req: http.IncomingMessage) =>
  new Promise<string>((resolve) => {
    let d = "";
    req.on("data", (c) => (d += c));
    req.on("end", () => resolve(d));
  });

// ── Fake Upstash Redis ──────────────────────────────────────────────────────
http.createServer(async (req, res) => {
  const body = JSON.parse((await readBody(req)) || "[]");
  res.setHeader("content-type", "application/json");
  if (req.headers.authorization !== "Bearer redis-token") return void res.writeHead(401).end(JSON.stringify({ error: "WRONGPASS" }));
  const r = redis.http(new URL(req.url!, "http://x").pathname, body);
  res.writeHead(r.status).end(JSON.stringify(r.json));
}).listen(4301);

// ── Fake Resend ─────────────────────────────────────────────────────────────
http.createServer(async (req, res) => {
  const body = JSON.parse((await readBody(req)) || "{}");
  const r = resend.send(String(req.headers.authorization), body);
  res.setHeader("content-type", "application/json");
  res.writeHead(r.status).end(JSON.stringify(r.json));
}).listen(4304);

// ── Fake Telegram Bot API (+ test controls) ─────────────────────────────────
let updateId = 1;
http.createServer(async (req, res) => {
  const url = new URL(req.url!, "http://x");
  const raw = await readBody(req);
  res.setHeader("content-type", "application/json");
  const reply = (status: number, payload: unknown) => res.writeHead(status).end(JSON.stringify(payload));

  if (url.pathname === "/__sent") return reply(200, sent);
  if (url.pathname === "/__emails") return reply(200, resend.emails);
  if (url.pathname === "/__clear-sent") { sent.length = 0; resend.emails.length = 0; return reply(200, {}); }
  if (url.pathname === "/__reset") {
    sent.length = 0;
    resend.emails.length = 0;
    redis.clear();
    telegram.webhookUrl = WEBHOOK.url;
    return reply(200, {});
  }
  if (url.pathname === "/__redis") return reply(200, { result: redis.run(JSON.parse(raw)) });
  if (url.pathname === "/__cron") {
    // Runs the real /api/cron as if `shiftMinutes` minutes had passed.
    const shift = Number(url.searchParams.get("shiftMinutes") ?? 0) * 60_000;
    const realNow = Date.now;
    Date.now = () => realNow() + shift;
    try {
      const r = await fetch("http://127.0.0.1:4303/api/cron", { headers: { authorization: "Bearer cron-secret" } });
      return reply(r.status, await r.json());
    } finally {
      Date.now = realNow;
    }
  }
  if (url.pathname === "/__push") {
    const { chat, text, secret } = JSON.parse(raw);
    const r = await fetch("http://127.0.0.1:4303/api/webhook", {
      method: "POST",
      headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": secret ?? WEBHOOK.secret },
      body: JSON.stringify({ update_id: updateId++, message: { message_id: 1, from: { id: chat, is_bot: false }, chat: { id: chat, type: "private" }, text } }),
    });
    return reply(200, { status: r.status });
  }
  const m = url.pathname.match(/^\/bot([^/]+)\/(\w+)$/);
  if (!m) return reply(404, { ok: false });
  const out = telegram.call(m[1], m[2], new URLSearchParams(raw));
  return reply(out.ok ? 200 : 401, out.ok ? out : { ...out, error_code: 401 });
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
  vres.send = (b: string) => res.end(b);
  await mod.default(vreq, vres);
}).listen(4303, () => console.log("harness ready"));
