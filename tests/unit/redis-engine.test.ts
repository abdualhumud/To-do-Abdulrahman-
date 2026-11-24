import { test } from "node:test";
import assert from "node:assert/strict";
import { RedisEngine, type Entry } from "../../telegram-bot/lib/redis-engine.ts";

function make(start = 1_000_000) {
  const clock = { t: start };
  return { e: new RedisEngine(() => clock.t), clock };
}

test("strings: SET/GET/GETDEL/NX/INCR", () => {
  const { e } = make();
  assert.equal(e.run(["SET", "a", "1"]), "OK");
  assert.equal(e.run(["SET", "a", "2", "NX"]), null);
  assert.equal(e.run(["GET", "a"]), "1");
  assert.equal(e.run(["INCR", "a"]), 2);
  assert.equal(e.run(["GETDEL", "a"]), "2");
  assert.equal(e.run(["GET", "a"]), null);
  assert.equal(e.run(["SET", "b", "x", "NX"]), "OK");
});

test("keys expire lazily (SET EX, EXPIRE) and INCR keeps the TTL", () => {
  const { e, clock } = make();
  e.run(["SET", "k", "v", "EX", 10]);
  e.run(["INCR", "n"]);
  e.run(["EXPIRE", "n", 5]);
  e.run(["INCR", "n"]);
  clock.t += 4_000;
  assert.equal(e.run(["GET", "k"]), "v");
  assert.equal(e.run(["GET", "n"]), "2");
  clock.t += 2_000; // 6 s: n (5 s) is gone, k (10 s) is not
  assert.equal(e.run(["GET", "n"]), null);
  assert.equal(e.run(["GET", "k"]), "v");
  clock.t += 5_000;
  assert.equal(e.run(["EXISTS", "k"]), 0);
  assert.equal(e.run(["EXPIRE", "missing", 5]), 0);
});

test("lists: RPUSH/LRANGE/LTRIM with negative indexes; an emptied list disappears", () => {
  const { e } = make();
  e.run(["RPUSH", "l", "a", "b", "c", "d"]);
  assert.deepEqual(e.run(["LRANGE", "l", 0, 1]), ["a", "b"]);
  assert.deepEqual(e.run(["LRANGE", "l", -2, -1]), ["c", "d"]);
  e.run(["LTRIM", "l", -3, -1]);
  assert.deepEqual(e.run(["LRANGE", "l", 0, -1]), ["b", "c", "d"]);
  e.run(["LTRIM", "l", 3, -1]);
  assert.equal(e.run(["EXISTS", "l"]), 0);
  assert.deepEqual(e.run(["LRANGE", "none", 0, -1]), []);
});

test("hashes: HSET/HGET/HGETALL/HKEYS/HLEN/HDEL and cleanup", () => {
  const { e } = make();
  assert.equal(e.run(["HSET", "h", "a", "1", "b", "2"]), 2);
  assert.equal(e.run(["HSET", "h", "a", "9"]), 0);
  assert.equal(e.run(["HGET", "h", "a"]), "9");
  assert.deepEqual(e.run(["HGETALL", "h"]), ["a", "9", "b", "2"]);
  assert.deepEqual(e.run(["HKEYS", "h"]), ["a", "b"]);
  assert.equal(e.run(["HLEN", "h"]), 2);
  assert.equal(e.run(["HDEL", "h", "a", "zzz"]), 1);
  e.run(["HDEL", "h", "b"]);
  assert.equal(e.run(["EXISTS", "h"]), 0);
});

test("sorted sets: ordering, ranges, WITHSCORES, LIMIT, ZREM claims exactly once", () => {
  const { e } = make();
  e.run(["ZADD", "z", 30, "c"]);
  e.run(["ZADD", "z", 10, "a"]);
  e.run(["ZADD", "z", 20, "b"]);
  assert.deepEqual(e.run(["ZRANGEBYSCORE", "z", "-inf", 20]), ["a", "b"]);
  assert.deepEqual(e.run(["ZRANGEBYSCORE", "z", "-inf", "+inf", "WITHSCORES"]), ["a", "10", "b", "20", "c", "30"]);
  assert.deepEqual(e.run(["ZRANGEBYSCORE", "z", "-inf", "+inf", "WITHSCORES", "LIMIT", 1, 1]), ["b", "20"]);
  assert.equal(e.run(["ZREM", "z", "a"]), 1);
  assert.equal(e.run(["ZREM", "z", "a"]), 0);
  e.run(["ZADD", "z", 5, "c"]); // re-adding updates the score
  assert.deepEqual(e.run(["ZRANGEBYSCORE", "z", "-inf", "+inf"]), ["c", "b"]);
});

test("wrong types and unknown commands fail loudly", () => {
  const { e } = make();
  e.run(["SET", "s", "x"]);
  assert.throws(() => e.run(["RPUSH", "s", "a"]), /WRONGTYPE/);
  assert.throws(() => e.run(["NOPE"]), /unsupported/);
});

test("dirty tracking persists changes and deletions, and a reloaded engine behaves identically", () => {
  const { e, clock } = make();
  e.run(["SET", "s", "v"]);
  e.run(["RPUSH", "l", "a"]);
  e.run(["HSET", "h", "f", "1"]);
  e.run(["ZADD", "z", 1, "m"]);
  e.run(["EXPIRE", "s", 100]);
  const first = e.takeDirty();
  assert.deepEqual(first.puts.map(([k]) => k).sort(), ["h", "l", "s", "z"]);
  assert.deepEqual(first.deletes, []);
  assert.deepEqual(e.takeDirty(), { puts: [], deletes: [] }); // drained

  e.run(["DEL", "l"]);
  e.run(["GET", "nothing"]); // reads never dirty anything
  const second = e.takeDirty();
  assert.deepEqual([second.puts.length, second.deletes], [0, ["l"]]);

  const storage = new Map<string, Entry>(first.puts.filter(([k]) => k !== "l"));
  const reborn = new RedisEngine(() => clock.t);
  reborn.load(storage);
  assert.equal(reborn.run(["GET", "s"]), "v");
  assert.equal(reborn.run(["HGET", "h", "f"]), "1");
  assert.deepEqual(reborn.run(["ZRANGEBYSCORE", "z", "-inf", "+inf"]), ["m"]);
  clock.t += 101_000;
  assert.equal(reborn.run(["GET", "s"]), null); // TTL survived the reload
  assert.equal(reborn.run(["PURGE"]), 0);
});

test("PURGE removes expired keys and FLUSHALL empties everything (and reports deletions)", () => {
  const { e, clock } = make();
  e.run(["SET", "a", "1", "EX", 1]);
  e.run(["SET", "b", "2"]);
  e.takeDirty();
  clock.t += 2_000;
  assert.equal(e.run(["PURGE"]), 1);
  assert.deepEqual(e.takeDirty().deletes, ["a"]);
  e.run(["FLUSHALL"]);
  assert.equal(e.size(), 0);
  assert.deepEqual(e.takeDirty().deletes, ["b"]);
});
