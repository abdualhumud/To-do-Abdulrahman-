import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readEnv } from "../../telegram-bot/lib/infra.ts";
import {
  getVapid,
  handleCron,
  handleFeed,
  handleFeedCreate,
  handlePush,
  handleReminders,
  runDue,
  syncItems,
  validateItems,
  type PushSubscription,
} from "../../telegram-bot/lib/reminders.ts";
import { handleStatus } from "../../telegram-bot/lib/core.ts";
import { zonedToEpoch } from "../../telegram-bot/lib/recurrence.ts";
import { FakeRedis, FakeResend, FakeTelegram } from "./helpers/fakes.ts";

const TOKEN = "123456789:AAHdqTcvCH1vGWJxfSeofSs0K38CIDabcde";
const KEY = "abcdefghijklmnopqrstuvwxyz012345";
const CRON = "cron-secret";
const RIYADH = "Asia/Riyadh";
const env = readEnv({
  TELEGRAM_BOT_TOKEN: TOKEN,
  TELEGRAM_WEBHOOK_SECRET: "wh-secret",
  CRON_SECRET: CRON,
  UPSTASH_REDIS_REST_URL: "http://redis.test",
  UPSTASH_REDIS_REST_TOKEN: "redis-token",
  TELEGRAM_API_BASE: "http://tg.test",
  RESEND_API_KEY: "re_test",
  RESEND_API_BASE: "http://resend.test",
  REMINDER_EMAIL_TO: "owner@elm.sa",
});

const redis = new FakeRedis();
const telegram = new FakeTelegram(TOKEN);
const resend = new FakeResend();

before(() => {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("http://redis.test")) {
      const r = redis.http(new URL(url).pathname, JSON.parse(String(init?.body)));
      return new Response(JSON.stringify(r.json), { status: r.status });
    }
    if (url === "http://resend.test/emails") {
      const r = resend.send((init?.headers as Record<string, string>).Authorization, JSON.parse(String(init?.body)));
      return new Response(JSON.stringify(r.json), { status: r.status });
    }
    const m = /^http:\/\/tg\.test\/bot([^/]+)\/(\w+)$/.exec(url);
    if (!m) throw new Error(`unexpected fetch ${url}`);
    return new Response(JSON.stringify(telegram.call(m[1], m[2], new URLSearchParams(String(init?.body ?? "")))));
  }) as typeof fetch;
});

beforeEach(() => {
  redis.clear();
  telegram.sent.length = 0;
  resend.emails.length = 0;
  resend.reject = false;
  redis.run(["SET", `linked:${KEY}`, 555]); // chat 555 is linked to this app
});

// Tuesday 17 Nov 2026, 13:00 in Riyadh
const NOW = zonedToEpoch(2026, 11, 17, 13, 0, RIYADH);
const HOUR = 3_600_000;
const body = (items: unknown[]) => ({ tz: RIYADH, appUrl: "https://example.github.io/app/", items });
const dueMembers = () => redis.run(["ZRANGEBYSCORE", "due", "-inf", "+inf", "WITHSCORES"]) as string[];

const pushSent: { endpoint: string; payload: string }[] = [];
const sendPush = async (sub: PushSubscription, payload: string) => {
  if (sub.endpoint.includes("gone")) throw Object.assign(new Error("gone"), { statusCode: 410 });
  pushSent.push({ endpoint: sub.endpoint, payload });
};

test("validation keeps only well-formed dated items and caps their number", () => {
  const items = validateItems(
    [
      { id: "ok", title: "  Call mom  ", due_date: "2026-11-20", channels: ["telegram", "fax"], repeat: "daily" },
      { id: "bad id!", title: "x", due_date: "2026-11-20" },
      { id: "nodate", title: "no date" },
      { id: "badrepeat", title: "x", due_date: "2026-11-20", repeat: "hourly" },
      { id: "ok", title: "duplicate id", due_date: "2026-11-20" },
      { id: "old", title: "ancient", reminder_at: 1000 },
      { id: "far", title: "far future", reminder_at: NOW + 10 * 365 * 24 * HOUR },
    ],
    NOW,
    "Not/AZone",
    "http://not-https",
  );
  assert.deepEqual(items.map((i) => i.id), ["ok", "badrepeat"]);
  assert.equal(items[0].title, "Call mom");
  assert.deepEqual(items[0].channels, ["telegram"]);
  assert.equal(items[0].tz, "UTC");
  assert.equal(items[0].appUrl, "");
  assert.equal(items[1].repeat, "none");
  assert.equal(validateItems(Array.from({ length: 500 }, (_, i) => ({ id: `i${i}`, title: "t", due_date: "2026-11-20" })), NOW, "UTC", "").length, 300);
});

test("sync schedules reminders, keeps dated-only tasks for the calendar, and is replace-all", async () => {
  const at = NOW + HOUR;
  const s = await syncItems(env, KEY, body([
    { id: "r1", title: "Call mom", reminder_at: at, channels: ["telegram"] },
    { id: "d1", title: "Pay rent", due_date: "2026-11-30" },
    { id: "noch", title: "Reminder without channel", reminder_at: at, channels: [] },
  ]), NOW);
  assert.deepEqual([s.reminders, s.calendar, s.nextFire], [1, 3, at]);
  assert.deepEqual(dueMembers(), [`${KEY}|r1`, String(at)]);

  // the user deletes r1 and d1 in the app → the next sync removes them
  await syncItems(env, KEY, body([{ id: "noch", title: "Reminder without channel", reminder_at: at, channels: [] }]), NOW);
  assert.deepEqual(dueMembers(), []);
  assert.equal(redis.run(["HLEN", `cal:${KEY}`]), 1);
  await syncItems(env, KEY, body([]), NOW);
  assert.equal(redis.run(["HLEN", `cal:${KEY}`]), 0);
});

test("a due one-off reminder is delivered to Telegram once and then removed", async () => {
  const at = NOW + HOUR;
  await syncItems(env, KEY, body([{ id: "r1", title: "Call mom", description: "about Friday", reminder_at: at, channels: ["telegram"] }]), NOW);
  assert.equal((await runDue(env, NOW)).fired.length, 0); // not yet
  assert.equal(telegram.sent.length, 0);

  const run = await runDue(env, at + 30_000);
  assert.equal(run.fired.length, 1);
  assert.deepEqual(run.fired[0].deliveries, [{ channel: "telegram", ok: true, detail: "sent" }]);
  assert.equal(telegram.sent[0].chat, 555);
  assert.match(telegram.sent[0].text, /⏰ Call mom/);
  assert.match(telegram.sent[0].text, /14:00/); // 17 Nov 2026, 14:00 Riyadh
  assert.match(telegram.sent[0].text, /about Friday/);
  assert.deepEqual(dueMembers(), []);

  // another sync of the same (unchanged) task must not resurrect it
  await syncItems(env, KEY, body([{ id: "r1", title: "Call mom", reminder_at: at, channels: ["telegram"] }]), at + 60_000);
  assert.deepEqual(dueMembers(), []);
  assert.equal((await runDue(env, at + 120_000)).fired.length, 0);
  assert.equal(telegram.sent.length, 1);
});

test("editing the time of an already delivered reminder schedules it again", async () => {
  const at = NOW + HOUR;
  await syncItems(env, KEY, body([{ id: "r1", title: "x", reminder_at: at, channels: ["telegram"] }]), NOW);
  await runDue(env, at);
  const later = at + 5 * HOUR;
  await syncItems(env, KEY, body([{ id: "r1", title: "x", reminder_at: later, channels: ["telegram"] }]), at + 1000);
  assert.deepEqual(dueMembers(), [`${KEY}|r1`, String(later)]);
});

test("overlapping cron runs send a reminder only once", async () => {
  const at = NOW + HOUR;
  await syncItems(env, KEY, body([{ id: "r1", title: "x", reminder_at: at, channels: ["telegram"] }]), NOW);
  await Promise.all([runDue(env, at), runDue(env, at), runDue(env, at)]);
  assert.equal(telegram.sent.length, 1);
});

test("a daily reminder is rescheduled for the next day at the same local time and never refires on resync", async () => {
  const at = zonedToEpoch(2026, 11, 17, 17, 0, RIYADH);
  await syncItems(env, KEY, body([{ id: "p", title: "Pills", reminder_at: at, repeat: "daily", channels: ["telegram"] }]), NOW);
  await runDue(env, at);
  const tomorrow = zonedToEpoch(2026, 11, 18, 17, 0, RIYADH);
  assert.deepEqual(dueMembers(), [`${KEY}|p`, String(tomorrow)]);
  await syncItems(env, KEY, body([{ id: "p", title: "Pills", reminder_at: at, repeat: "daily", channels: ["telegram"] }]), at + 1000);
  assert.deepEqual(dueMembers(), [`${KEY}|p`, String(tomorrow)]);
  await runDue(env, tomorrow);
  assert.equal(telegram.sent.length, 2);
  assert.match(telegram.sent[1].text, /18 Nov 2026, 17:00/);
});

test("email goes only to the owner address configured on the server", async () => {
  const at = NOW + HOUR;
  await syncItems(env, KEY, body([{ id: "e", title: "Quarterly report", reminder_at: at, channels: ["email"], to: "victim@example.com" }]), NOW);
  const run = await runDue(env, at);
  assert.equal(resend.emails.length, 1);
  assert.deepEqual(resend.emails[0].to, ["owner@elm.sa"]);
  assert.equal(resend.emails[0].auth, "Bearer re_test");
  assert.match(resend.emails[0].subject, /Quarterly report/);
  assert.equal(run.fired[0].deliveries[0].detail, "sent to o****@elm.sa");
});

test("a failing channel is reported without blocking the others", async () => {
  resend.reject = true;
  const at = NOW + HOUR;
  await syncItems(env, KEY, body([{ id: "m", title: "Both", reminder_at: at, channels: ["email", "telegram"] }]), NOW);
  const d = (await runDue(env, at)).fired[0].deliveries;
  const by = Object.fromEntries(d.map((x) => [x.channel, x]));
  assert.deepEqual([by.email.ok, by.telegram.ok], [false, true]);
  assert.match(by.email.detail, /domain not verified/);
  assert.equal(telegram.sent.length, 1);
});

test("an unlinked Telegram chat is reported, not silently ignored", async () => {
  redis.run(["DEL", `linked:${KEY}`]);
  const at = NOW + HOUR;
  await syncItems(env, KEY, body([{ id: "t", title: "x", reminder_at: at, channels: ["telegram"] }]), NOW);
  assert.match((await runDue(env, at)).fired[0].deliveries[0].detail, /not linked/);
});

test("phone push: delivers to every device and forgets devices that were unsubscribed (410)", async () => {
  pushSent.length = 0;
  const headers = { authorization: `Bearer ${KEY}` };
  const sub = (endpoint: string) => ({ subscription: { endpoint, keys: { p256dh: "p", auth: "a" } } });
  assert.equal((await handlePush(env, "POST", headers, sub("https://fcm.googleapis.com/fcm/send/device-1"))).status, 200);
  assert.equal((await handlePush(env, "POST", headers, sub("https://fcm.googleapis.com/fcm/send/gone-2"))).status, 200);
  assert.equal((await handlePush(env, "POST", headers, { subscription: { endpoint: "http://insecure" } })).status, 400);
  assert.equal((await handlePush(env, "POST", {}, sub("https://fcm.googleapis.com/fcm/send/x"))).status, 401);
  // SSRF guard: only real push services; no internal hosts, ports, credentials or look-alikes
  for (const bad of ["https://push.example/device", "https://169.254.169.254/latest", "https://fcm.googleapis.com.evil.test/x", "https://user:pw@fcm.googleapis.com/x", "https://fcm.googleapis.com:8443/x"]) {
    assert.equal((await handlePush(env, "POST", headers, sub(bad))).status, 400, bad);
  }
  // a well-formed key that was never linked by the owner is refused everywhere
  const stranger = { authorization: `Bearer ${"z".repeat(32)}` };
  assert.equal((await handlePush(env, "POST", stranger, sub("https://fcm.googleapis.com/fcm/send/y"))).status, 401);
  assert.equal((await handleReminders(env, "POST", stranger, { test: "email" }, {}, NOW)).status, 401);
  assert.equal((await handleFeedCreate(env, stranger, "x.test")).status, 401);

  const at = NOW + HOUR;
  await syncItems(env, KEY, body([{ id: "p1", title: "Stand up", reminder_at: at, channels: ["push"] }]), NOW);
  const d = (await runDue(env, at, { sendPush })).fired[0].deliveries[0];
  assert.deepEqual([d.ok, d.detail], [true, "1 device(s)"]);
  assert.equal(pushSent.length, 1);
  assert.equal(JSON.parse(pushSent[0].payload).title, "⏰ Stand up");
  assert.equal(redis.run(["HLEN", `push:${KEY}`]), 1); // the gone device was removed

  await handlePush(env, "DELETE", headers, { endpoint: "https://fcm.googleapis.com/fcm/send/device-1" });
  assert.equal(redis.run(["HLEN", `push:${KEY}`]), 0);
});

test("VAPID keys are generated once, are the right shape, and appear in /api/status", async () => {
  const a = await getVapid(env);
  const b = await getVapid(env);
  assert.deepEqual(a, b);
  assert.equal(Buffer.from(a.publicKey, "base64url").length, 65); // uncompressed P-256 point
  assert.equal(Buffer.from(a.privateKey, "base64url").length, 32);
  const status = (await handleStatus(env, "GET")).body as { vapidPublicKey: string; email: { configured: boolean; to: string } };
  assert.equal(status.vapidPublicKey, a.publicKey);
  assert.deepEqual(status.email, { configured: true, to: "o****@elm.sa" });
});

test("the reminders endpoint requires the key, syncs, and sends test messages per channel", async () => {
  const h = { authorization: `Bearer ${KEY}` };
  assert.equal((await handleReminders(env, "PUT", {}, {}, {}, NOW)).status, 401);
  assert.equal((await handleReminders(env, "OPTIONS", {}, {}, {}, NOW)).status, 204);
  const put = await handleReminders(env, "PUT", h, {}, body([{ id: "a", title: "A", due_date: "2026-11-30" }]), NOW);
  assert.deepEqual([put.status, (put.body as { calendar: number }).calendar], [200, 1]);

  const tg = await handleReminders(env, "POST", h, { test: "telegram" }, {}, NOW);
  assert.equal((tg.body as { delivered: boolean }).delivered, true);
  assert.match(telegram.sent.at(-1)!.text, /TaskFlow test reminder/);
  const mail = await handleReminders(env, "POST", h, { test: "email" }, {}, NOW);
  assert.equal((mail.body as { delivered: boolean }).delivered, true);
  const push = await handleReminders(env, "POST", h, { test: "push" }, {}, NOW);
  assert.equal((push.body as { ok: boolean; delivered: boolean }).ok, true); // the request worked…
  assert.equal((push.body as { delivered: boolean }).delivered, false); // …but nothing could be delivered
  assert.match((push.body as { detail: string }).detail, /No phone/);
});

test("cron needs the secret (Bearer or ?key=) and runs everything due", async () => {
  const at = NOW + HOUR;
  await syncItems(env, KEY, body([{ id: "c", title: "x", reminder_at: at, channels: ["telegram"] }]), NOW);
  assert.equal((await handleCron(env, {}, {}, at)).status, 401);
  assert.equal((await handleCron(env, { authorization: "Bearer wrong" }, {}, at)).status, 401);
  const ok = await handleCron(env, { authorization: `Bearer ${CRON}` }, {}, at);
  assert.deepEqual([ok.status, (ok.body as { fired: number }).fired], [200, 1]);
  assert.equal((await handleCron(env, {}, { key: CRON }, at)).status, 200);
});

test("calendar feed: private URL, valid ICS, hides removed tasks, rejects unknown keys", async () => {
  const at = zonedToEpoch(2026, 11, 20, 9, 0, RIYADH);
  await syncItems(env, KEY, body([
    { id: "r1", title: "Standup", reminder_at: at, repeat: "sun-thu", channels: [] },
    { id: "d1", title: "Pay rent", due_date: "2026-11-30" },
  ]), NOW);

  assert.equal((await handleFeedCreate(env, {}, "bot.vercel.app")).status, 401);
  const created = (await handleFeedCreate(env, { authorization: `Bearer ${KEY}` }, "bot.vercel.app")).body as { url: string };
  const again = (await handleFeedCreate(env, { authorization: `Bearer ${KEY}` }, "bot.vercel.app")).body as { url: string };
  assert.equal(created.url, again.url); // stable
  assert.match(created.url, /^https:\/\/bot\.vercel\.app\/api\/feed\?k=[A-Za-z0-9]{32}$/);
  const fk = new URL(created.url).searchParams.get("k")!;

  const feed = await handleFeed(env, fk, NOW);
  assert.equal(feed.status, 200);
  assert.match(feed.contentType!, /text\/calendar/);
  const ics = String(feed.body);
  assert.match(ics, /SUMMARY:Standup/);
  assert.match(ics, /RRULE:FREQ=WEEKLY;BYDAY=SU,MO,TU,WE,TH/);
  assert.match(ics, /DTSTART;VALUE=DATE:20261130/);
  assert.match(ics, /BEGIN:VALARM/);

  assert.equal((await handleFeed(env, "x".repeat(32), NOW)).status, 404);
  assert.equal((await handleFeed(env, "short", NOW)).status, 404);

  await syncItems(env, KEY, body([{ id: "d1", title: "Pay rent", due_date: "2026-11-30" }]), NOW);
  assert.ok(!/Standup/.test(String((await handleFeed(env, fk, NOW)).body)));
});
