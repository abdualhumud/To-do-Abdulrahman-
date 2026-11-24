import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readEnv } from "../../telegram-bot/lib/infra.ts";
import { MAX_PULL, MAX_PUSH, handleSync, sha256Hex } from "../../telegram-bot/lib/sync.ts";
import { FakeRedis } from "./helpers/fakes.ts";

const env = readEnv({
  TELEGRAM_BOT_TOKEN: "123456789:AAHdqTcvCH1vGWJxfSeofSs0K38CIDabcde",
  TELEGRAM_WEBHOOK_SECRET: "wh",
  UPSTASH_REDIS_REST_URL: "http://redis.test",
  UPSTASH_REDIS_REST_TOKEN: "t",
  MAX_VAULTS: "2",
});
const redis = new FakeRedis();
before(() => {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const r = redis.http(new URL(String(input)).pathname, JSON.parse(String(init?.body)));
    return new Response(JSON.stringify(r.json), { status: r.status });
  }) as typeof fetch;
});
beforeEach(() => redis.clear());

const VAULT = "A".repeat(22);
const TOKEN = "t".repeat(43);
const OTHER_VAULT = "B".repeat(22);
const OTHER_TOKEN = "u".repeat(43);
const auth = (v = VAULT, t = TOKEN) => ({ authorization: `Bearer ${v}.${t}` });
const call = (op: string, method: string, body?: unknown, headers: Record<string, string | undefined> = auth()) => handleSync(env, method, headers, { op }, body);
interface Reply {
  ok: boolean;
  accepted: string[];
  rejected: string[];
  changes: { key: string; seq: number; u: number; dev: string; c: string }[];
  cursor: number;
  more: boolean;
  seq?: number;
  items?: number;
}
const ok = async (p: ReturnType<typeof call>): Promise<Reply> => {
  const r = await p;
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body as Reply;
};
const OWNER_KEY = "o".repeat(32);
const make = (v = VAULT, t = TOKEN) => {
  redis.run(["SET", `linked:${OWNER_KEY}`, 1]); // the owner's linked Telegram key authorises creating vaults
  return handleSync(env, "POST", { authorization: `Bearer ${OWNER_KEY}` }, { op: "create" }, { vaultId: v, token: t });
};
const rec = (key: string, u: number, dev: string, c = "Y2lwaGVydGV4dA") => ({ key, u, dev, c });
const exchange = (dev: string, since: number, push: unknown[] = [], v = VAULT, t = TOKEN) => ok(call("exchange", "POST", { dev, since, push }, auth(v, t)));

test("creating a vault validates credentials, refuses duplicates and respects the server cap", async () => {
  assert.equal((await handleSync(env, "POST", { authorization: `Bearer ${OWNER_KEY}` }, { op: "create" }, { vaultId: "short", token: TOKEN })).status, 400);
  assert.equal((await make()).status, 200);
  assert.equal((await make()).status, 409);
  assert.equal((await make(OTHER_VAULT, OTHER_TOKEN)).status, 200);
  const third = await make("C".repeat(22), "v".repeat(43));
  assert.equal(third.status, 403);
  assert.match((third.body as { error: string }).error, /MAX_VAULTS/);
  assert.equal((await handleSync(env, "GET", {}, { op: "create" }, undefined)).status, 405);
});

test("the token is stored hashed, never in clear", async () => {
  await make();
  assert.equal(redis.run(["GET", `sv:${VAULT}:auth`]), await sha256Hex(TOKEN));
  assert.ok(![...JSON.stringify([...redis["data" as keyof typeof redis] as unknown as Map<string, unknown>])].join("").includes(TOKEN));
});

test("every vault operation needs the right vault id AND token", async () => {
  await make();
  for (const h of [{}, { authorization: "Bearer nope" }, auth(VAULT, "z".repeat(43)), auth(OTHER_VAULT, TOKEN), { authorization: `Basic ${VAULT}.${TOKEN}` }]) {
    assert.equal((await call("info", "GET", undefined, h)).status, 401);
    assert.equal((await call("exchange", "POST", { push: [] }, h)).status, 401);
  }
  assert.deepEqual(await ok(call("info", "GET")), { ok: true, seq: 0, items: 0 });
});

test("push assigns increasing sequence numbers; another device pulls them; a device never gets its own writes back", async () => {
  await make();
  const a = await exchange("devA", 0, [rec("task:t1", 10, "devA"), rec("tag:g1", 11, "devA")]);
  assert.deepEqual([a.accepted, a.rejected, a.changes.length], [["task:t1", "tag:g1"], [], 0]);
  assert.equal(a.cursor, 2); // scanned past its own two records

  const b = await exchange("devB", 0);
  assert.deepEqual(b.changes.map((c: { key: string; seq: number }) => [c.key, c.seq]), [["task:t1", 1], ["tag:g1", 2]]);
  assert.deepEqual([b.cursor, b.more], [2, false]);
  assert.deepEqual((await exchange("devB", b.cursor)).changes, []);
  assert.deepEqual(await ok(call("info", "GET")), { ok: true, seq: 2, items: 2 });
});

test("last-writer-wins per item: older and equal versions are rejected, newer ones accepted and re-announced", async () => {
  await make();
  await exchange("devA", 0, [rec("task:t1", 100, "devA", "first")]);
  const stale = await exchange("devB", 0, [rec("task:t1", 90, "devB", "older")]);
  assert.deepEqual([stale.accepted, stale.rejected], [[], ["task:t1"]]);
  assert.equal(stale.changes[0].c, "first"); // B learns the winner right away

  const same = await exchange("devB", 0, [rec("task:t1", 100, "devA", "same")]);
  assert.deepEqual(same.rejected, ["task:t1"]);
  const tie = await exchange("devB", 0, [rec("task:t1", 100, "devB", "tie")]); // same u, "devB" > "devA"
  assert.deepEqual(tie.accepted, ["task:t1"]);

  const newer = await exchange("devA", 0, [rec("task:t1", 200, "devA", "newest")]);
  assert.deepEqual(newer.accepted, ["task:t1"]);
  const later = await exchange("devB", 0);
  assert.equal(later.changes.length, 1);
  assert.equal(later.changes[0].c, "newest");
  assert.equal(later.changes[0].seq, 3); // the item moved to the head of the log
});

test("malformed records are ignored, not fatal", async () => {
  await make();
  const big = "x".repeat(24_001);
  const r = await exchange("devA", 0, [
    rec("task:ok", 5, "devA"),
    rec("evil:key", 5, "devA"),
    rec("task:../../x", 5, "devA"),
    rec("task:big", 5, "devA", big),
    { key: "task:nou", dev: "devA", c: "abc" },
    rec("task:baddev", 5, "bad dev!"),
    rec("task:zero", 0, "devA"),
    null,
  ]);
  assert.deepEqual(r.accepted, ["task:ok"]);
  assert.equal((await ok(call("info", "GET"))).items, 1);
});

test("pushes beyond the batch limit are ignored; pulls are paged with `more` and a usable cursor", async () => {
  await make();
  const total = 650;
  for (let i = 0; i < total; i += MAX_PUSH) {
    await exchange("devA", 0, Array.from({ length: Math.min(MAX_PUSH, total - i) }, (_, j) => rec(`task:i${i + j}`, 1000 + i + j, "devA")));
  }
  assert.equal((await ok(call("info", "GET"))).items, total);
  const tooMany = await exchange("devA", 0, Array.from({ length: MAX_PUSH + 50 }, (_, j) => rec(`task:x${j}`, 1, "devA")));
  assert.equal(tooMany.accepted.length, MAX_PUSH);

  let cursor = 0;
  const seen = new Set<string>();
  let pages = 0;
  for (;;) {
    const page = await exchange("devB", cursor);
    page.changes.forEach((c: { key: string }) => seen.add(c.key));
    cursor = page.cursor;
    pages++;
    if (!page.more) break;
    assert.ok(page.changes.length === MAX_PULL);
  }
  assert.ok(pages >= 3);
  assert.equal(seen.size, total + MAX_PUSH);
});

test("vaults are isolated from each other", async () => {
  await make();
  await make(OTHER_VAULT, OTHER_TOKEN);
  await exchange("devA", 0, [rec("task:secret", 5, "devA", "mine")]);
  const other = await exchange("devZ", 0, [], OTHER_VAULT, OTHER_TOKEN);
  assert.deepEqual(other.changes, []);
});

test("pairing: a wrapped secret can be fetched exactly once, without authentication", async () => {
  await make();
  const lookup = await sha256Hex("lookup:CODE");
  const wrapped = "w".repeat(100);
  assert.equal((await call("pair", "POST", { lookup: "nothex", wrapped })).status, 400);
  assert.equal((await call("pair", "POST", { lookup, wrapped: "tiny" })).status, 400);
  assert.equal((await call("pair", "POST", { lookup, wrapped }, {})).status, 401); // only a member can offer a pairing
  assert.equal((await call("pair", "POST", { lookup, wrapped })).status, 200);

  assert.equal((await call("join", "POST", { lookup: await sha256Hex("lookup:WRONG") }, {})).status, 404);
  const first = await call("join", "POST", { lookup }, {});
  assert.deepEqual([first.status, (first.body as { wrapped: string }).wrapped], [200, wrapped]);
  assert.equal((await call("join", "POST", { lookup }, {})).status, 404); // consumed
  assert.equal((await call("join", "POST", { lookup: "x" }, {})).status, 400);
});

test("joining is rate limited", async () => {
  let limited = 0;
  for (let i = 0; i < 40; i++) if ((await call("join", "POST", { lookup: await sha256Hex(`l${i}`) }, {})).status === 429) limited++;
  assert.ok(limited > 0);
});

test("deleting a vault erases its data and frees a slot; other vaults survive", async () => {
  await make();
  await make(OTHER_VAULT, OTHER_TOKEN);
  await exchange("devA", 0, Array.from({ length: 250 }, (_, i) => rec(`task:d${i}`, 10 + i, "devA")));
  await exchange("devZ", 0, [rec("task:keep", 5, "devZ")], OTHER_VAULT, OTHER_TOKEN);
  assert.equal((await call("delete", "DELETE")).status, 200);

  assert.equal((await call("info", "GET")).status, 401); // the vault is gone
  assert.equal(redis.run(["GET", "svcount"]), "1");
  assert.equal(redis.run(["ZCARD", `sv:${VAULT}:log`]), 0);
  assert.equal(redis.run(["GET", `sv:${VAULT}:i:task:d1`]), null);
  assert.equal((await exchange("devZ", 0, [], OTHER_VAULT, OTHER_TOKEN)).cursor, 1); // untouched
  assert.equal((await make("C".repeat(22), "v".repeat(43))).status, 200); // slot reused
  assert.equal((await call("delete", "POST", undefined, auth(OTHER_VAULT, OTHER_TOKEN))).status, 405); // wrong verb on a live vault
});

test("a server without storage reports the problem instead of failing silently", async () => {
  const bare = readEnv({});
  assert.equal((await handleSync(bare, "POST", {}, { op: "create" }, {})).status, 503);
  assert.equal((await handleSync(env, "OPTIONS", {}, {}, undefined)).status, 204);
});

test("strangers cannot create vaults, and the day-ahead clock limit protects items", async () => {
  const stranger = await handleSync(env, "POST", { authorization: `Bearer ${"s".repeat(32)}` }, { op: "create" }, { vaultId: VAULT, token: TOKEN });
  assert.equal(stranger.status, 403);
  assert.equal((await handleSync(env, "POST", {}, { op: "create" }, { vaultId: VAULT, token: TOKEN })).status, 403);
  await make();
  const far = Date.now() + 3 * 24 * 3600 * 1000;
  const r = await exchange("aaaa", 0, [rec("task:far", far, "aaaa"), rec("task:ok", 1000, "aaaa")]);
  assert.deepEqual(r.accepted, ["task:ok"]);
});

test("deleting twice never drives the vault counter below zero", async () => {
  await make();
  assert.equal((await call("delete", "DELETE")).status, 200);
  assert.equal((await call("delete", "DELETE")).status, 401);
  assert.equal(Number(redis.run(["GET", "svcount"])), 0);
});
