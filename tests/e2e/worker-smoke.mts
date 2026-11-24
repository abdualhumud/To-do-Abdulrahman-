// Cloudflare Worker checks that need a real workerd: scheduled handler, Web Push crypto, persistence.
//   cd cloudflare && npm ci && cd .. && npm run test:worker
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decrypt, subscriber } from "../unit/helpers/webpush-receiver.ts";
import { b64urlDecode } from "../../telegram-bot/lib/webpush.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const wrangler = path.join(root, "cloudflare/node_modules/.bin/wrangler");
if (!existsSync(wrangler)) { console.error("Run `npm ci` inside cloudflare/ first."); process.exit(2); }

const BOT = "http://127.0.0.1:4303";
const T = "http://127.0.0.1:4302";
const persist = mkdtempSync(path.join(os.tmpdir(), "tf-worker-smoke-"));
const children: ChildProcess[] = [];
let failures = 0;
const check = (name: string, ok: boolean, extra = "") => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const stop = (c: ChildProcess) => { try { process.kill(-c.pid!); } catch { /* gone */ } };
process.on("exit", () => children.forEach(stop));

writeFileSync(path.join(root, "cloudflare/.dev.vars"), [
  "TELEGRAM_BOT_TOKEN=123456789:AAHdqTcvCH1vGWJxfSeofSs0K38CIDabcde", "TELEGRAM_WEBHOOK_SECRET=test-webhook-secret", "CRON_SECRET=cron-secret",
  "RESEND_API_KEY=re_test", "REMINDER_EMAIL_TO=owner@elm.sa", "TELEGRAM_API_BASE=http://127.0.0.1:4302", "RESEND_API_BASE=http://127.0.0.1:4304", "ALLOW_TEST_CLOCK=1", "",
].join("\n"));

async function waitFor(url: string) {
  for (let i = 0; i < 80; i++) { try { await fetch(url); return; } catch { await sleep(500); } }
  throw new Error(`${url} did not start`);
}
function startWorker(): ChildProcess {
  const c = spawn(wrangler, ["dev", "--port", "4303", "--ip", "127.0.0.1", "--test-scheduled", "--persist-to", persist], { cwd: path.join(root, "cloudflare"), stdio: "ignore", detached: true });
  children.push(c);
  return c;
}
const api = (p: string, init: RequestInit = {}) => fetch(BOT + p, init).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) as any }));
const j = (key: string) => ({ authorization: `Bearer ${key}`, "content-type": "application/json" });

children.push(spawn("npx", ["--yes", "tsx", path.join(root, "tests/e2e/fake-services.mts")], { cwd: root, stdio: "ignore", detached: true }));
let worker = startWorker();
await waitFor(`${T}/__sent`);
await waitFor(`${BOT}/api/status`);
await fetch(`${T}/__reset`, { method: "POST" });

// ── link a chat, register a phone ───────────────────────────────────────────
const pair = (await api("/api/pair", { method: "POST" })).json;
await fetch(`${T}/__push`, { method: "POST", body: JSON.stringify({ chat: 777, text: "/link " + pair.code }) });
check("pairing works on the Worker", (await api("/api/inbox", { headers: j(pair.inboxKey) })).json.linked === true);

const phone = await subscriber();
const reg = await api("/api/push", { method: "POST", headers: j(pair.inboxKey), body: JSON.stringify({ subscription: { endpoint: "http://127.0.0.1:4305/push/1", keys: phone.sub.keys } }) });
const gone = await api("/api/push", { method: "POST", headers: j(pair.inboxKey), body: JSON.stringify({ subscription: { endpoint: "http://127.0.0.1:4305/gone/2", keys: phone.sub.keys } }) });
check("push devices register", reg.status === 200 && gone.status === 200);

// ── scheduled handler sends due reminders (Telegram + push) ─────────────────
const now = Date.now();
const put = await api("/api/reminders", {
  method: "PUT", headers: j(pair.inboxKey),
  body: JSON.stringify({ tz: "Asia/Riyadh", appUrl: "https://user.github.io/app/dashboard/", items: [
    { id: "due-now", title: "اتصل بأمي", reminder_at: now - 20_000, repeat: "none", channels: ["telegram", "push"] },
    { id: "later", title: "Later today", reminder_at: now + 3_600_000, repeat: "daily", channels: ["telegram"] },
  ] }),
});
check("sync schedules both reminders", put.json.reminders === 2);
const sched = await fetch(`${BOT}/__scheduled?cron=*+*+*+*+*`);
await sleep(1500);
const sent = await (await fetch(`${T}/__sent`)).json() as { chat: number; text: string }[];
check("the minute-by-minute scheduled handler delivered the due reminder to Telegram", sched.status === 200 && sent.some((m) => m.chat === 777 && m.text.includes("اتصل بأمي")), sent.map((m) => m.text).join(" | ").slice(0, 80));
check("…and did not send the future one", !sent.some((m) => m.text.includes("Later today")));

const pushes = await (await fetch(`${T}/__pushes`)).json() as { url: string; headers: Record<string, string>; body: string }[];
const live = pushes.filter((p) => p.url.startsWith("/push/"));
check("push reached the device endpoint with aes128gcm + VAPID headers", live.length === 1 && live[0].headers["content-encoding"] === "aes128gcm" && /^vapid t=/.test(live[0].headers.authorization), JSON.stringify(live.map((p) => p.headers["content-encoding"])));
if (live[0]) {
  const message = JSON.parse((await decrypt(new Uint8Array(Buffer.from(live[0].body, "base64")), phone)).plain);
  check("workerd's WebCrypto produced a payload the device can decrypt", message.title === "⏰ اتصل بأمي" && message.url === "https://user.github.io/app/dashboard/", JSON.stringify(message).slice(0, 80));
  const m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(live[0].headers.authorization)!;
  const status = (await api("/api/status")).json;
  const key = await crypto.subtle.importKey("raw", b64urlDecode(status.vapidPublicKey), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  const valid = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, b64urlDecode(m[3]), new TextEncoder().encode(`${m[1]}.${m[2]}`));
  const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(m[2])));
  check("the VAPID signature verifies against the published public key", valid && m[4] === status.vapidPublicKey && claims.aud === "http://127.0.0.1:4305");
}
const after = (await api("/api/status")).json;
check("a 410 from the push service removes that device", (await (await fetch(`${T}/__redis`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(["HLEN", `push:${pair.inboxKey}`]) })).json() as any).result === 1);
const vapidBefore = after.vapidPublicKey;

check("cron endpoint refuses callers without the secret", (await api("/api/cron")).status === 401);

// ── persistence across a Worker restart ─────────────────────────────────────
await fetch(`${T}/__push`, { method: "POST", body: JSON.stringify({ chat: 777, text: "saved before restart" }) });
stop(worker);
await sleep(3000);
worker = startWorker();
await waitFor(`${BOT}/api/status`);
const inbox = (await api("/api/inbox", { headers: j(pair.inboxKey) })).json;
check("pairing and inbox survive a restart", inbox.linked === true && inbox.items.some((i: { text: string }) => i.text === "saved before restart"));
const due = (await (await fetch(`${T}/__redis`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(["ZRANGEBYSCORE", "due", "-inf", "+inf"]) })).json() as any).result;
check("scheduled reminders survive a restart", due.includes(`${pair.inboxKey}|later`));
check("the VAPID keys are not regenerated", (await api("/api/status")).json.vapidPublicKey === vapidBefore);
await fetch(`${T}/__push`, { method: "POST", body: JSON.stringify({ chat: 777, text: "after restart" }) });
check("the bot keeps working after the restart", (await api("/api/inbox", { headers: j(pair.inboxKey) })).json.items.some((i: { text: string }) => i.text === "after restart"));

console.log(failures === 0 ? "\nWORKER SMOKE TESTS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
