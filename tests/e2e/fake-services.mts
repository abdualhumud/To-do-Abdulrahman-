// Fake Telegram Bot API + fake Resend, with test controls. Works against ANY bot server
// (Node harness or the Cloudflare Worker) found at BOT_URL (default http://127.0.0.1:4303).
// Ports: telegram + controls 4302, resend 4304, web-push endpoint 4305.
import http from "node:http";
import { FakeResend, FakeTelegram } from "../unit/helpers/fakes.ts";

const BOT = process.env.BOT_URL ?? "http://127.0.0.1:4303";
const TOKEN = "123456789:AAHdqTcvCH1vGWJxfSeofSs0K38CIDabcde";
const SECRET = "test-webhook-secret";
const CRON_SECRET = "cron-secret";
const WEBHOOK_URL = "https://taskflow-bot.vercel.app/api/webhook";

const telegram = new FakeTelegram(TOKEN);
const resend = new FakeResend();
telegram.webhookUrl = WEBHOOK_URL;
let updateId = 1;

// A push service: records what the bot server POSTs to a subscription endpoint.
const pushes: { url: string; headers: http.IncomingHttpHeaders; body: string }[] = [];
http.createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  pushes.push({ url: req.url ?? "", headers: req.headers, body: Buffer.concat(chunks).toString("base64") });
  res.writeHead(req.url?.startsWith("/gone") ? 410 : 201).end();
}).listen(4305);

const readBody = (req: http.IncomingMessage) =>
  new Promise<string>((resolve) => {
    let d = "";
    req.on("data", (c) => (d += c));
    req.on("end", () => resolve(d));
  });

http.createServer(async (req, res) => {
  const body = JSON.parse((await readBody(req)) || "{}");
  const r = resend.send(String(req.headers.authorization), body);
  res.setHeader("content-type", "application/json");
  res.writeHead(r.status).end(JSON.stringify(r.json));
}).listen(4304);

http.createServer(async (req, res) => {
  const url = new URL(req.url!, "http://x");
  const raw = await readBody(req);
  res.setHeader("content-type", "application/json");
  const reply = (status: number, payload: unknown) => res.writeHead(status).end(JSON.stringify(payload));

  if (url.pathname === "/__sent") return reply(200, telegram.sent);
  if (url.pathname === "/__emails") return reply(200, resend.emails);
  if (url.pathname === "/__pushes") return reply(200, pushes);
  if (url.pathname === "/__clear-sent") { telegram.sent.length = 0; resend.emails.length = 0; pushes.length = 0; return reply(200, {}); }
  if (url.pathname === "/__reset") {
    telegram.sent.length = 0;
    resend.emails.length = 0;
    pushes.length = 0;
    telegram.webhookUrl = WEBHOOK_URL;
    await fetch(`${BOT}/__reset`, { method: "POST" });
    return reply(200, {});
  }
  if (url.pathname === "/__redis") {
    const r = await fetch(`${BOT}/__redis`, { method: "POST", headers: { "content-type": "application/json" }, body: raw });
    return reply(r.status, await r.json());
  }
  if (url.pathname === "/__cron") {
    // Runs the real /api/cron as if `shiftMinutes` minutes had passed.
    const shift = Number(url.searchParams.get("shiftMinutes") ?? 0) * 60_000;
    const r = await fetch(`${BOT}/api/cron`, { headers: { authorization: `Bearer ${CRON_SECRET}`, "x-test-now": String(Date.now() + shift) } });
    return reply(r.status, await r.json());
  }
  if (url.pathname === "/__push") {
    const { chat, text, secret } = JSON.parse(raw);
    const r = await fetch(`${BOT}/api/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": secret ?? SECRET },
      body: JSON.stringify({ update_id: updateId++, message: { message_id: 1, from: { id: chat, is_bot: false }, chat: { id: chat, type: "private" }, text } }),
    });
    return reply(200, { status: r.status });
  }
  const m = url.pathname.match(/^\/bot([^/]+)\/(\w+)$/);
  if (!m) return reply(404, { ok: false });
  const out = telegram.call(m[1], m[2], new URLSearchParams(raw));
  return reply(out.ok ? 200 : 401, out.ok ? out : { ...out, error_code: 401 });
}).listen(4302, () => console.log("fake services ready"));
