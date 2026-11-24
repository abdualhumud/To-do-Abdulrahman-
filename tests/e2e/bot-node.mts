// The Vercel handlers (telegram-bot/api/*.ts) on plain Node with a fake Upstash Redis.
// Port 4303 (bot) + 4301 (fake Redis REST). Started by tests/e2e/run.mjs.
import http from "node:http";
import { pathToFileURL } from "node:url";
import { FakeRedis } from "../unit/helpers/fakes.ts";

const ROOT = decodeURIComponent(new URL("../../telegram-bot", import.meta.url).pathname);
Object.assign(process.env, {
  TELEGRAM_BOT_TOKEN: "123456789:AAHdqTcvCH1vGWJxfSeofSs0K38CIDabcde",
  TELEGRAM_WEBHOOK_SECRET: "test-webhook-secret",
  UPSTASH_REDIS_REST_URL: "http://127.0.0.1:4301",
  UPSTASH_REDIS_REST_TOKEN: "redis-token",
  TELEGRAM_API_BASE: "http://127.0.0.1:4302",
  RESEND_API_KEY: "re_test",
  RESEND_API_BASE: "http://127.0.0.1:4304",
  REMINDER_EMAIL_TO: "owner@elm.sa",
  CRON_SECRET: "cron-secret",
  ALLOW_TEST_CLOCK: "1",
});

const redis = new FakeRedis();
const readBody = (req: http.IncomingMessage) =>
  new Promise<string>((resolve) => {
    let d = "";
    req.on("data", (c) => (d += c));
    req.on("end", () => resolve(d));
  });

http.createServer(async (req, res) => {
  const body = JSON.parse((await readBody(req)) || "[]");
  res.setHeader("content-type", "application/json");
  if (req.headers.authorization !== "Bearer redis-token") return void res.writeHead(401).end(JSON.stringify({ error: "WRONGPASS" }));
  const r = redis.http(new URL(req.url!, "http://x").pathname, body);
  res.writeHead(r.status).end(JSON.stringify(r.json));
}).listen(4301);

http.createServer(async (req, res) => {
  const url = new URL(req.url!, "http://x");
  const raw = await readBody(req);
  if (url.pathname === "/__redis") {
    res.setHeader("content-type", "application/json");
    return void res.end(JSON.stringify({ result: redis.run(JSON.parse(raw)) }));
  }
  if (url.pathname === "/__reset") { redis.clear(); return void res.end("{}"); }

  const m = url.pathname.match(/^\/api\/(\w+)$/);
  if (!m) return void res.writeHead(404).end("not found");
  const mod = await import(pathToFileURL(`${ROOT}/api/${m[1]}.ts`).href + `?t=${Date.now()}`);
  const vreq: any = Object.assign(req, {
    query: Object.fromEntries(url.searchParams),
    body: raw && (req.headers["content-type"] ?? "").includes("json") ? JSON.parse(raw) : raw || undefined,
  });
  const vres: any = res;
  vres.status = (c: number) => { res.statusCode = c; return vres; };
  vres.json = (b: unknown) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(b)); };
  vres.send = (b: string) => res.end(b);
  await mod.default(vreq, vres);
}).listen(4303, () => console.log("bot ready"));
