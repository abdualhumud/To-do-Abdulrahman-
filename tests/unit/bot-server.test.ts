// Runs the real telegram-bot handlers in-process against fakes of Upstash Redis (REST) and the Telegram Bot API.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { handleInbox, handlePair, handleSetup, handleStatus, handleWebhook, readEnv } from "../../telegram-bot/lib/core.ts";
import { FakeRedis, FakeTelegram } from "./helpers/fakes.ts";

const SECRET = "test-webhook-secret";
const TOKEN = "123456789:AAHdqTcvCH1vGWJxfSeofSs0K38CIDabcde";
const env = readEnv({
  TELEGRAM_BOT_TOKEN: TOKEN,
  TELEGRAM_WEBHOOK_SECRET: SECRET,
  UPSTASH_REDIS_REST_URL: "http://redis.test",
  UPSTASH_REDIS_REST_TOKEN: "redis-token",
  TELEGRAM_API_BASE: "http://tg.test",
});

// ── fakes ────────────────────────────────────────────────────────────────────
const redis = new FakeRedis();
const telegram = new FakeTelegram(TOKEN);
const sent = telegram.sent;

before(() => {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("http://redis.test")) {
      if ((init?.headers as Record<string, string>).Authorization !== "Bearer redis-token") return new Response(JSON.stringify({ error: "WRONGPASS" }), { status: 401 });
      const r = redis.http(new URL(url).pathname, JSON.parse(String(init?.body)));
      return new Response(JSON.stringify(r.json), { status: r.status });
    }
    const m = /^http:\/\/tg\.test\/bot([^/]+)\/(\w+)$/.exec(url);
    if (!m) throw new Error(`unexpected fetch ${url}`);
    const reply = telegram.call(m[1], m[2], new URLSearchParams(String(init?.body ?? "")));
    return new Response(JSON.stringify(reply), { status: reply.ok ? 200 : 401 });
  }) as typeof fetch;
});

// ── helpers ──────────────────────────────────────────────────────────────────
let updateId = 1;
const push = (chat: number, text: string, secret = SECRET) =>
  handleWebhook(env, { "x-telegram-bot-api-secret-token": secret }, {
    update_id: updateId++,
    message: { from: { id: chat, is_bot: false }, chat: { id: chat, type: "private" }, text },
  });
const pair = async (previousCode?: string) =>
  (await handlePair(env, "POST", previousCode ? { previousCode } : undefined)).body as { code: string; inboxKey: string; bot: string };
const box = async (key: string) => (await handleInbox(env, "GET", { authorization: `Bearer ${key}` }, undefined)).body as { linked: boolean; count: number; items: { text: string }[] };
const said = (chat: number, re: RegExp) => sent.some((m) => m.chat === chat && re.test(m.text));

// ── tests (sequential, share state like a real conversation) ─────────────────
let main: { code: string; inboxKey: string };

test("status: configured, bot and Redis reachable, webhook not set yet", async () => {
  const r = (await handleStatus(env, "GET")).body as Record<string, unknown>;
  assert.deepEqual([r.configured, r.bot, r.redis, r.webhookSet], [true, "taskflow_test_bot", true, false]);
});

test("setup rejects a wrong key and registers https://<host>/api/webhook with the right one", async () => {
  assert.equal((await handleSetup(env, { key: "wrong" }, "x.vercel.app")).status, 401);
  const r = await handleSetup(env, { key: SECRET }, "taskflow-bot.vercel.app");
  assert.equal(r.status, 200);
  assert.equal(telegram.webhookUrl, "https://taskflow-bot.vercel.app/api/webhook");
  assert.equal(((await handleStatus(env, "GET")).body as { webhookSet: boolean }).webhookSet, true);
});

test("a server without configuration says what is missing and refuses to run", async () => {
  const bare = readEnv({});
  const status = (await handleStatus(bare, "GET")).body as { configured: boolean; problem: string };
  assert.equal(status.configured, false);
  assert.match(status.problem, /TELEGRAM_BOT_TOKEN/);
  assert.equal((await handleWebhook(bare, {}, {})).status, 500);
  assert.equal((await handlePair(bare, "POST")).status, 503);
});

test("CORS preflight allows the Authorization header", async () => {
  const r = await handleInbox(env, "OPTIONS", {}, undefined);
  assert.equal(r.status, 204);
  assert.match(r.headers!["Access-Control-Allow-Headers"], /authorization/i);
});

test("pair returns an 8-char code, a 32-char key and the bot name", async () => {
  main = await pair();
  assert.match(main.code, /^[A-Z2-9]{8}$/);
  assert.match(main.inboxKey, /^[A-Za-z0-9]{32}$/);
});

test("inbox needs a well-formed key", async () => {
  assert.equal((await handleInbox(env, "GET", {}, undefined)).status, 401);
  assert.equal((await handleInbox(env, "GET", { authorization: "Bearer short" }, undefined)).status, 401);
  assert.deepEqual(await box(main.inboxKey), { ok: true, linked: false, count: 0, items: [] });
});

test("the webhook rejects calls without Telegram's secret header", async () => {
  assert.equal((await push(555, "hi", "nope")).status, 401);
});

test("an unlinked chat gets a hint; wrong codes are explained; nothing reaches the inbox", async () => {
  await push(555, "buy milk");
  await push(555, "/link WRONGCOD");
  assert.ok(said(555, /To link this chat/) && said(555, /wrong or expired/));
  assert.equal((await box(main.inboxKey)).count, 0);
});

test("the deep link /start link_CODE links the chat, and a code works only once", async () => {
  await push(555, "/start link_" + main.code);
  assert.ok(said(555, /Linked/));
  assert.equal((await box(main.inboxKey)).linked, true);
  await push(556, "/link " + main.code);
  assert.ok(said(556, /wrong or expired/));
});

test("the owner gets an instant confirmation and help; strangers are ignored", async () => {
  await push(555, "Buy milk tomorrow !high\nاشتري خبز بكرة");
  await push(555, "/help");
  await push(556, "stranger task");
  assert.ok(said(555, /Saved 2 lines/) && said(555, /TaskFlow bot/));
  const b = await box(main.inboxKey);
  assert.equal(b.count, 1);
  assert.match(b.items[0].text, /اشتري خبز بكرة/);
  assert.ok(!JSON.stringify(b).includes("stranger"));
});

test("ack removes only what was collected, order is kept", async () => {
  await push(555, "Second message");
  const before = await box(main.inboxKey);
  assert.equal(before.count, 2);
  assert.equal(before.items[1].text, "Second message");
  await handleInbox(env, "POST", { authorization: `Bearer ${main.inboxKey}` }, { count: 1 });
  const after = await box(main.inboxKey);
  assert.deepEqual(after.items.map((i) => i.text), ["Second message"]);
});

test("/unlink disconnects the chat and stops storing", async () => {
  await push(555, "/unlink");
  assert.equal((await box(main.inboxKey)).linked, false);
  await push(555, "after unlink");
  assert.ok((await box(main.inboxKey)).items.every((i) => i.text !== "after unlink"));
});

test("'New code' revokes the previous code", async () => {
  const a = await pair();
  const b = await pair(a.code);
  await push(600, "/link " + a.code);
  assert.ok(said(600, /wrong or expired/));
  await push(600, "/link " + b.code);
  assert.equal((await box(b.inboxKey)).linked, true);
});

test("re-linking a linked chat moves its pending messages; an 8-letter word is a task, not a code", async () => {
  const first = await pair();
  await push(700, "/link " + first.code);
  await push(700, "pending before relink");
  const second = await pair();
  await push(700, "/start link_" + second.code);
  const oldBox = await box(first.inboxKey);
  const newBox = await box(second.inboxKey);
  assert.ok(newBox.linked && newBox.items.some((i) => i.text === "pending before relink"));
  assert.ok(!oldBox.linked && oldBox.count === 0);
  await push(700, "Shopping");
  assert.ok((await box(second.inboxKey)).items.some((i) => i.text === "Shopping"));
});

test("a linked chat that sends an explicit but invalid /link command is told why", async () => {
  const c = await pair();
  await push(800, "/link " + c.code);
  await push(800, "/link ZZZZZZZZ");
  assert.ok(said(800, /wrong or expired/));
  assert.ok((await box(c.inboxKey)).items.every((i) => !/ZZZZZZZZ/.test(i.text)));
});

test("the public status endpoint is rate limited", async () => {
  let limited = 0;
  for (let i = 0; i < 70; i++) if ((await handleStatus(env, "GET")).status === 429) limited++;
  assert.ok(limited > 0);
});

test("pairing is rate limited", async () => {
  let limited = 0;
  for (let i = 0; i < 40; i++) if ((await handlePair(env, "POST")).status === 429) limited++;
  assert.ok(limited > 0);
});
