import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readEnv } from "../../telegram-bot/lib/infra.ts";
import { handleSync } from "../../telegram-bot/lib/sync.ts";
import { FakeRedis } from "./helpers/fakes.ts";
import { syncOnce, type Host, type Transport } from "../../src/lib/sync-engine.ts";
import { importVaultKey, newDeviceId, newVaultSecrets, newPairCode, normalizeCode, pairLookup, wrapForPairing, unwrapFromPairing, isCompleteCode, encryptRecord, decryptRecord, DecryptError } from "../../src/lib/sync-crypto.ts";
import type { LocalData, SyncMeta } from "../../src/lib/sync-core.ts";

const env = readEnv({ TELEGRAM_BOT_TOKEN: "123456789:AAHdqTcvCH1vGWJxfSeofSs0K38CIDabcde", TELEGRAM_WEBHOOK_SECRET: "wh", UPSTASH_REDIS_REST_URL: "http://redis.test", UPSTASH_REDIS_REST_TOKEN: "t" });
const redis = new FakeRedis();
before(() => {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const r = redis.http(new URL(String(input)).pathname, JSON.parse(String(init?.body)));
    return new Response(JSON.stringify(r.json), { status: r.status });
  }) as typeof fetch;
});
beforeEach(() => redis.clear());

class Device {
  data: LocalData = { tasks: [], tags: [], habits: [], completions: [] };
  meta: SyncMeta = { dev: newDeviceId(), clock: 0, cursor: 0, known: {} };
  t = 1_000_000;
  constructor(public secrets: ReturnType<typeof newVaultSecrets>, public user: string) {}
  host(): Host {
    return { read: () => this.data, write: (d) => { this.data = d; }, meta: this.meta, save: () => undefined, userId: () => this.user, now: () => this.t, validate: (_k, i) => typeof i.id === "string" };
  }
  transport(): Transport {
    return {
      exchange: async (req) => {
        const r = await handleSync(env, "POST", { authorization: `Bearer ${this.secrets.vaultId}.${this.secrets.token}` }, { op: "exchange" }, req);
        assert.equal(r.status, 200, JSON.stringify(r.body));
        return r.body as never;
      },
    };
  }
  async sync() { return syncOnce(this.host(), this.transport(), await importVaultKey(this.secrets.key)); }
  add(id: string, title: string) { this.data = { ...this.data, tasks: [...this.data.tasks, { id, title, user_id: this.user, order_index: this.data.tasks.length }] }; }
  edit(id: string, title: string) { this.data = { ...this.data, tasks: this.data.tasks.map((x) => (x.id === id ? { ...x, title } : x)) }; }
  remove(id: string) { this.data = { ...this.data, tasks: this.data.tasks.filter((x) => x.id !== id) }; }
  titles() { return this.data.tasks.map((x) => `${x.id}:${x.title}`).sort(); }
}

async function twoDevices() {
  const secrets = newVaultSecrets();
  redis.run(["SET", `linked:${"o".repeat(32)}`, 1]);
  const r = await handleSync(env, "POST", { authorization: `Bearer ${"o".repeat(32)}` }, { op: "create" }, { vaultId: secrets.vaultId, token: secrets.token });
  assert.equal(r.status, 200);
  return [new Device(secrets, "user-A"), new Device(secrets, "user-B")] as const;
}

test("a task created on one device appears on the other, and edits/deletes propagate", async () => {
  const [a, b] = await twoDevices();
  a.add("t1", "buy milk");
  await a.sync();
  await b.sync();
  assert.deepEqual(b.titles(), ["t1:buy milk"]);
  assert.equal(b.data.tasks[0].user_id, "user-B", "records are re-owned by the local profile");

  b.t += 10; b.edit("t1", "buy oat milk"); await b.sync();
  await a.sync();
  assert.deepEqual(a.titles(), ["t1:buy oat milk"]);

  a.t += 10; a.remove("t1"); await a.sync();
  await b.sync();
  assert.deepEqual(b.titles(), []);
});

test("concurrent offline edits converge on the same winner everywhere", async () => {
  const [a, b] = await twoDevices();
  a.add("t1", "base"); await a.sync(); await b.sync();
  a.t += 100; a.edit("t1", "from A"); a.add("a-only", "A task");
  b.t += 200; b.edit("t1", "from B"); b.add("b-only", "B task");
  await a.sync(); await b.sync(); await a.sync(); await b.sync();
  assert.deepEqual(a.titles(), b.titles());
  assert.deepEqual(a.titles(), ["a-only:A task", "b-only:B task", "t1:from B"]);
});

test("a device with a slow clock still wins after seeing newer data", async () => {
  const [a, b] = await twoDevices();
  a.t = 9_000_000; a.add("t1", "v1"); await a.sync(); await b.sync();
  b.t = 1_000; b.edit("t1", "v2 from slow clock"); await b.sync(); await a.sync();
  assert.deepEqual(a.titles(), ["t1:v2 from slow clock"]);
});

test("more than one page of changes is pulled completely", async () => {
  const [a, b] = await twoDevices();
  for (let i = 0; i < 650; i++) a.add(`t${i}`, `task ${i}`);
  await a.sync();
  const r = await b.sync();
  assert.equal(b.data.tasks.length, 650);
  assert.equal(r.pulled, 650);
});

test("a different key cannot read the vault", async () => {
  const [a] = await twoDevices();
  a.add("t1", "secret"); await a.sync();
  const imposter = new Device({ ...a.secrets, key: newVaultSecrets().key }, "x");
  await assert.rejects(() => imposter.sync(), DecryptError);
});

test("records are authenticated: moving ciphertext to another item fails", async () => {
  const k = await importVaultKey(newVaultSecrets().key);
  const c = await encryptRecord(k, { key: "task:1", u: 5, dev: "aaaa" }, { id: "1" });
  await assert.rejects(() => decryptRecord(k, { key: "task:2", u: 5, dev: "aaaa" }, c), DecryptError);
  await assert.rejects(() => decryptRecord(k, { key: "task:1", u: 6, dev: "aaaa" }, c), DecryptError);
  assert.deepEqual(await decryptRecord(k, { key: "task:1", u: 5, dev: "aaaa" }, c), { id: "1" });
});

test("pairing code wraps the secrets; wrong code fails; codes are normalised", async () => {
  const s = newVaultSecrets();
  const code = newPairCode();
  assert.ok(isCompleteCode(code));
  const wrapped = await wrapForPairing(code, { ...s, serverUrl: "https://x.workers.dev", inboxKey: "ik" });
  const back = await unwrapFromPairing(normalizeCode(code.toLowerCase().replace(/(.{4})/g, "$1-")), wrapped);
  assert.equal(back.key, s.key);
  assert.equal(back.inboxKey, "ik");
  const wrong = code[0] === "A" ? "B" + code.slice(1) : "A" + code.slice(1);
  await assert.rejects(() => unwrapFromPairing(wrong, wrapped), DecryptError);
  assert.notEqual(await pairLookup(code), await pairLookup(wrong));
});

test("end to end pairing through the server is single use", async () => {
  const [a] = await twoDevices();
  const code = newPairCode();
  const wrapped = await wrapForPairing(code, { ...a.secrets, serverUrl: "https://x" });
  const auth = { authorization: `Bearer ${a.secrets.vaultId}.${a.secrets.token}` };
  assert.equal((await handleSync(env, "POST", auth, { op: "pair" }, { lookup: await pairLookup(code), wrapped })).status, 200);
  const first = await handleSync(env, "POST", {}, { op: "join" }, { lookup: await pairLookup(code) });
  assert.equal(first.status, 200);
  assert.equal((await handleSync(env, "POST", {}, { op: "join" }, { lookup: await pairLookup(code) })).status, 404);
});
