import { test } from "node:test";
import assert from "node:assert/strict";
import { applyRemote, commitPush, diffLocal, isClean, signature, type LocalData, type SyncMeta, type Remote } from "../../src/lib/sync-core";

const empty = (): LocalData => ({ tasks: [], tags: [], habits: [], completions: [] });
const meta = (dev: string): SyncMeta => ({ dev, clock: 0, cursor: 0, known: {} });
const ok = () => true;

test("signature ignores key order and user_id", () => {
  assert.equal(signature({ id: "1", a: 1, b: { x: 1, y: 2 }, user_id: "A" }), signature({ b: { y: 2, x: 1 }, id: "1", user_id: "B", a: 1 }));
  assert.notEqual(signature({ id: "1", a: 1 }), signature({ id: "1", a: 2 }));
});

test("new, edited and deleted items are detected exactly once", () => {
  const m = meta("aaaa");
  const d = empty();
  d.tasks.push({ id: "t1", title: "x", order_index: 0 });
  let p = diffLocal(d, m, 1000);
  assert.deepEqual(p.map((x) => x.key), ["task:t1"]);
  commitPush(m, p, ["task:t1"], []);
  assert.equal(isClean(d, m), true);
  assert.equal(diffLocal(d, m, 2000).length, 0);

  d.tasks[0] = { ...d.tasks[0], title: "y" };
  p = diffLocal(d, m, 3000);
  assert.equal(p.length, 1);
  commitPush(m, p, ["task:t1"], []);

  d.tasks = [];
  p = diffLocal(d, m, 4000);
  assert.equal(p[0].del, true);
  commitPush(m, p, ["task:t1"], []);
  assert.equal(diffLocal(d, m, 5000).length, 0);
});

test("clock never goes backwards even if the device clock does", () => {
  const m = meta("aaaa");
  const d = empty();
  d.tasks.push({ id: "t1", title: "x" });
  const a = diffLocal(d, m, 5000)[0].u;
  d.tasks.push({ id: "t2", title: "y" });
  const b = diffLocal(d, m, 1000);
  assert.ok(b.every((x) => x.u > a));
});

test("remote newer wins, dirty local edit wins, stale remote ignored", () => {
  const m = meta("bbbb");
  const d = empty();
  d.tasks.push({ id: "t1", title: "mine" });
  commitPush(m, diffLocal(d, m, 1000), ["task:t1"], []);

  const newer: Remote = { key: "task:t1", u: 5000, dev: "aaaa", payload: { id: "t1", title: "theirs" } };
  const r = applyRemote(d, m, [newer], { userId: "U", validate: ok });
  assert.equal(r.data.tasks[0].title, "theirs");
  assert.equal(r.data.tasks[0].user_id, "U");

  // local edit not yet pushed: remote must not clobber it
  r.data.tasks[0] = { ...r.data.tasks[0], title: "edited" };
  const other: Remote = { key: "task:t1", u: 6000, dev: "aaaa", payload: { id: "t1", title: "theirs2" } };
  const r2 = applyRemote(r.data, m, [other], { userId: "U", validate: ok });
  assert.equal(r2.data.tasks[0].title, "edited");
  const p = diffLocal(r2.data, m, 100);
  assert.ok(p[0].u > 6000, "local edit is stamped above everything seen");

  // stale
  const stale: Remote = { key: "task:t1", u: 10, dev: "aaaa", payload: { id: "t1", title: "old" } };
  assert.equal(applyRemote(r2.data, m, [stale], { userId: "U", validate: ok }).applied, 0);
});

test("remote tombstone deletes; invalid records are skipped", () => {
  const m = meta("bbbb");
  const d = empty();
  d.tasks.push({ id: "t1", title: "x" });
  commitPush(m, diffLocal(d, m, 1000), ["task:t1"], []);
  const r = applyRemote(d, m, [{ key: "task:t1", u: 9000, dev: "aaaa", payload: { __del: true } }], { userId: "U", validate: ok });
  assert.equal(r.data.tasks.length, 0);
  const bad = applyRemote(empty(), meta("cccc"), [{ key: "task:t2", u: 9, dev: "aaaa", payload: { id: "t2" } }], { userId: "U", validate: () => false });
  assert.equal(bad.data.tasks.length, 0);
});

test("rejected push lets the newer server version apply", () => {
  const m = meta("bbbb");
  const d = empty();
  d.tasks.push({ id: "t1", title: "mine" });
  const p = diffLocal(d, m, 1000);
  commitPush(m, p, [], ["task:t1"]);
  const r = applyRemote(d, m, [{ key: "task:t1", u: 2000, dev: "aaaa", payload: { id: "t1", title: "server" } }], { userId: "U", validate: ok });
  assert.equal(r.data.tasks[0].title, "server");
});
