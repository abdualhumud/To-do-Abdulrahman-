// Loads public/sw.js into a sandbox with a fake ServiceWorkerGlobalScope.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

type Handler = (event: Record<string, unknown>) => void;
type Shown = { body?: string; tag?: string; data: { url: string } };

const code = fs.readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");

function load(windows: { focus: () => unknown }[] = []) {
  const listeners: Record<string, Handler> = {};
  const shown: [string, Shown][] = [];
  const opened: string[] = [];
  const self = {
    addEventListener: (type: string, fn: Handler) => { listeners[type] = fn; },
    skipWaiting: () => undefined,
    clients: { claim: () => undefined, matchAll: async () => windows, openWindow: async (u: string) => { opened.push(u); } },
    registration: { scope: "https://user.github.io/app/", showNotification: async (t: string, o: Shown) => { shown.push([t, o]); } },
    location: { origin: "https://user.github.io" },
  };
  vm.runInNewContext(code, { self, URL, Promise });
  const fire = async (type: string, event: Record<string, unknown>) => {
    const waits: Promise<unknown>[] = [];
    listeners[type]({ ...event, waitUntil: (p: Promise<unknown>) => waits.push(p) });
    await Promise.all(waits);
  };
  return { fire, shown, opened };
}

test("a push message becomes a notification with title, body, tag and target", async () => {
  const sw = load();
  await sw.fire("push", { data: { json: () => ({ title: "⏰ Call mom", body: "17:00", tag: "t1", url: "https://user.github.io/app/dashboard/" }) } });
  assert.equal(sw.shown.length, 1);
  assert.equal(sw.shown[0][0], "⏰ Call mom");
  assert.deepEqual([sw.shown[0][1].body, sw.shown[0][1].tag, sw.shown[0][1].data.url], ["17:00", "t1", "https://user.github.io/app/dashboard/"]);
});

test("a non-JSON push still shows something readable", async () => {
  const sw = load();
  await sw.fire("push", { data: { json: () => { throw new Error("bad"); }, text: () => "plain text" } });
  assert.deepEqual([sw.shown[0][0], sw.shown[0][1].body], ["TaskFlow", "plain text"]);
});

test("an empty push does not crash", async () => {
  const sw = load();
  await sw.fire("push", { data: null });
  assert.equal(sw.shown[0][0], "TaskFlow");
});

test("clicking opens the app URL; a foreign origin falls back to the app scope", async () => {
  const a = load();
  await a.fire("notificationclick", { notification: { close: () => undefined, data: { url: "https://user.github.io/app/dashboard/" } } });
  assert.deepEqual(a.opened, ["https://user.github.io/app/dashboard/"]);
  const b = load();
  await b.fire("notificationclick", { notification: { close: () => undefined, data: { url: "https://evil.example/phish" } } });
  assert.deepEqual(b.opened, ["https://user.github.io/app/"]);
});

test("clicking focuses an already open window instead of opening another", async () => {
  let focused = 0;
  const sw = load([{ focus: () => { focused++; } }]);
  await sw.fire("notificationclick", { notification: { close: () => undefined, data: {} } });
  assert.equal(focused, 1);
  assert.equal(sw.opened.length, 0);
});
