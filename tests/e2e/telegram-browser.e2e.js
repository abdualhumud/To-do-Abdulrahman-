const { chromium } = require("playwright");
const fs = require("fs");
const os = require("os");
const path = require("path");

const BASE = "http://localhost:4173/To-do-Abdulrahman-";
const TOKEN = "123456789:AAHdqTcvCH1vGWJxfSeofSs0K38CIDabcde";
const BAD_TOKEN = "987654321:AAHzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz";
const OWNER = 777;
let failures = 0;
const check = (name, ok, extra = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tg = { webhook: "", updates: [], nextId: 1, sent: [], down: false, conflictOnce: false, calls: [] };
const push = (chatId, text) => tg.updates.push({ update_id: tg.nextId++, message: { message_id: tg.nextId, from: { id: chatId, is_bot: false }, chat: { id: chatId, type: "private" }, text } });

async function installMock(ctx) {
  await ctx.route("https://api.telegram.org/**", async (route) => {
    const cors = { "access-control-allow-origin": "*", "content-type": "application/json" };
    const m = new URL(route.request().url()).pathname.match(/^\/bot([^/]+)\/(\w+)$/);
    if (tg.down) return route.abort("failed");
    const [, token, method] = m;
    tg.calls.push(method);
    const body = new URLSearchParams(route.request().postData() || "");
    const reply = (status, payload) => route.fulfill({ status, headers: cors, body: JSON.stringify(payload) });
    if (token !== TOKEN) return reply(401, { ok: false, error_code: 401, description: "Unauthorized" });
    if (method === "getMe") return reply(200, { ok: true, result: { id: 1, is_bot: true, username: "testbot" } });
    if (method === "deleteWebhook") { tg.webhook = ""; return reply(200, { ok: true, result: true }); }
    if (method === "getWebhookInfo") return reply(200, { ok: true, result: { url: tg.webhook } });
    if (method === "sendMessage") { tg.sent.push({ chat: Number(body.get("chat_id")), text: body.get("text") }); return reply(200, { ok: true, result: {} }); }
    if (method === "getUpdates") {
      if (tg.webhook || tg.conflictOnce) {
        tg.conflictOnce = false;
        return reply(409, { ok: false, error_code: 409, description: "Conflict: can't use getUpdates method while webhook is active; use deleteWebhook to delete the webhook first" });
      }
      return reply(200, { ok: true, result: tg.updates.filter((u) => u.update_id >= Number(body.get("offset") || 0)) });
    }
    return reply(200, { ok: true, result: true });
  });
}

const title = (page, text) => page.locator("p.font-medium", { hasText: text });
async function toastText(page) { return (await page.locator('[role="status"]').allInnerTexts()).join(" | "); }
async function connect(page, tokenInput) {
  await page.getByPlaceholder("123456789:AA…").fill(tokenInput);
  await page.getByRole("button", { name: /Connect bot/ }).click();
}
const currentCode = async (page) => (await page.locator("code", { hasText: "/link " }).first().innerText()).replace("/link", "").trim();

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tf-tg-"));
  const ctx = await chromium.launchPersistentContext(dir, { headless: true });
  await installMock(ctx);
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto(BASE + "/register/");
  await page.fill('input[type="text"]', "Tester");
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard/);
  await page.goto(BASE + "/settings/");
  await page.getByPlaceholder("123456789:AA…").waitFor();

  // 1. wrong token → clear message
  await connect(page, BAD_TOKEN);
  await page.getByText(/doesn't accept this token/).first().waitFor({ timeout: 5000 }).catch(() => {});
  check("bad token: explains how to get the right token", /doesn't accept this token/.test(await toastText(page)));
  // 2. nonsense → format message
  await connect(page, "hello");
  await sleep(300);
  check("garbage input: format hint", /doesn't look like a bot token/.test(await toastText(page)));
  // 3. network down → network message
  tg.down = true;
  await connect(page, TOKEN);
  await sleep(600);
  check("network down: says Telegram is unreachable", /Couldn't reach Telegram/.test(await toastText(page)));
  tg.down = false;
  // 4. pasted as "<bot…>" with newline — as a person would copy it
  await connect(page, `<bot${TOKEN}>\n`);
  await page.getByText("@testbot").first().waitFor({ timeout: 5000 });
  check("token pasted with < >, 'bot' prefix and newline is accepted", true);

  // 5. wrong code, then the bare right code (no /link) pairs
  let code = await currentCode(page);
  push(999, "hello bot");
  push(OWNER, "/link ZZZZZZZZ");
  push(OWNER, code); // bare code
  await page.getByText(/Connected to/).waitFor({ timeout: 15000 }).catch(() => {});
  check("bare code pairs the chat", await page.getByText(/Connected to/).isVisible());
  check("wrong code got a helpful reply, once per chat per poll", tg.sent.filter((s) => s.chat === OWNER && /not the current one/.test(s.text)).length === 1 && tg.sent.some((s) => s.chat === 999 && /To link this chat/.test(s.text)));

  // 6. leftover webhook → app self-heals on 409
  tg.webhook = "https://old-bot.vercel.app/api/webhook";
  push(OWNER, "Recovered task");
  await page.getByRole("button", { name: /Sync now/ }).click();
  await sleep(700);
  check("409 conflict → webhook deleted by the app", tg.webhook === "");
  await page.getByRole("button", { name: /Sync now/ }).click();
  await sleep(700);

  // 7. diagnostics names the leftover webhook
  tg.webhook = "https://old-bot.vercel.app/api/webhook";
  await page.getByRole("button", { name: /Check connection/ }).click();
  await page.getByText(/Removed a leftover webhook/).waitFor({ timeout: 5000 }).catch(() => {});
  check("diagnostics: finds and removes leftover webhook", await page.getByText(/old-bot\.vercel\.app/).isVisible() && tg.webhook === "");
  check("diagnostics: shows token ok + linked", (await page.getByText(/Telegram accepts the token/).isVisible()) && (await page.getByText(/Chat linked: Yes/).isVisible()));

  // 8. messages sent while the app is closed arrive when it opens
  await page.goto("about:blank");
  push(OWNER, "Sent while closed A");
  push(OWNER, "Sent while closed B tomorrow !high");
  const p2 = await ctx.newPage();
  p2.on("pageerror", (e) => errors.push(e.message));
  await p2.goto(BASE + "/dashboard/");
  await title(p2, "Sent while closed A").waitFor({ timeout: 10000 }).catch(() => {});
  check("closed-app messages imported on next open", (await title(p2, "Sent while closed A").count()) === 1 && (await title(p2, "Sent while closed B").count()) === 1);
  check("earlier task from the 409 poll also arrived", (await title(p2, "Recovered task").count()) === 1);

  // 9. two tabs: no duplicates
  const p3 = await ctx.newPage();
  p3.on("pageerror", (e) => errors.push(e.message));
  await p3.goto(BASE + "/dashboard/");
  await title(p3, "Sent while closed A").waitFor();
  push(OWNER, "Two tab one");
  push(OWNER, "Two tab two");
  await Promise.all([p2.bringToFront(), sleep(100)]);
  await p2.evaluate(() => window.dispatchEvent(new Event("focus")));
  await p3.evaluate(() => window.dispatchEvent(new Event("focus")));
  await sleep(2500);
  await p2.reload();
  await title(p2, "Two tab one").waitFor({ timeout: 8000 }).catch(() => {});
  const c1 = await title(p2, "Two tab one").count();
  const c2 = await title(p2, "Two tab two").count();
  check("two tabs polling: each message imported exactly once", c1 === 1 && c2 === 1, `counts ${c1},${c2}`);

  check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  await ctx.close();
  console.log(failures === 0 ? "\nALL TELEGRAM CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error("TEST CRASHED", e); process.exit(2); });
