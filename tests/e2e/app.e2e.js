const { chromium } = require("playwright");
const fs = require("fs");
const os = require("os");
const path = require("path");

const BASE = "http://localhost:4173/To-do-Abdulrahman-";
const TOKEN = "123456789:AAHdqTcvCH1vGWJxfSeofSs0K38CIDabcde";
let failures = 0;
const check = (name, ok, extra = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const title = (page, text) => page.locator("p.font-medium", { hasText: text });

async function launch(dir) {
  const ctx = await chromium.launchPersistentContext(dir, { headless: true, acceptDownloads: true });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push("pageerror: " + e.message));
  page.on("console", (m) => m.type() === "error" && !/favicon|404/.test(m.text()) && page.errors.push("console: " + m.text()));
  return { ctx, page };
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tf-profile-"));
  let { ctx, page } = await launch(dir);

  // ── A. Sign up + quick add with live preview ────────────────────────────────
  await page.goto(BASE + "/register/");
  await page.fill('input[type="text"]', "Test User");
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard/);
  let quick = page.locator('input[placeholder^="Quick add"]');
  await quick.fill("Persisted task tomorrow !high");
  check("quick-add shows parsed preview", await page.getByText("Will add as").isVisible());
  await quick.press("Enter");
  await title(page, "Persisted task").waitFor();
  check("quick-add created task (title cleaned)", (await title(page, "Persisted task").first().innerText()).includes("Persisted task") && !(await title(page, "Persisted task").first().innerText()).includes("tomorrow"));
  await sleep(600);

  // ── B. Reload keeps session + data ──────────────────────────────────────────
  await page.reload();
  await title(page, "Persisted task").waitFor({ timeout: 8000 }).catch(() => {});
  check("reload: still on dashboard", /dashboard/.test(page.url()), page.url());
  check("reload: task still there", (await title(page, "Persisted task").count()) === 1);

  // ── C. Real browser restart ────────────────────────────────────────────────
  await ctx.close();
  ({ ctx, page } = await launch(dir));
  await page.goto(BASE + "/dashboard/");
  quick = page.locator('input[placeholder^="Quick add"]');
  await title(page, "Persisted task").waitFor({ timeout: 8000 }).catch(() => {});
  check("restart: still signed in", /dashboard/.test(page.url()), page.url());
  check("restart: task survived", (await title(page, "Persisted task").count()) === 1);

  // ── D. Capture link: multi-line, Arabic, list markers ───────────────────────
  const add = "Buy milk tomorrow\n- [ ] Call mom Friday !urgent\nاشتري خبز بكرة #صحة";
  await page.goto(BASE + "/dashboard/?add=" + encodeURIComponent(add));
  await title(page, "Buy milk").waitFor({ timeout: 8000 }).catch(() => {});
  const cnt = [await title(page, "Buy milk").count(), await title(page, "Call mom").count(), await title(page, "اشتري خبز").count()];
  check("capture: 3 tasks added", cnt.join() === "1,1,1", "counts=" + cnt.join() + " titles=" + JSON.stringify(await page.locator("p.font-medium").allInnerTexts()));
  check("capture: URL cleaned", !page.url().includes("add="), page.url());
  check("capture: existing task kept", (await title(page, "Persisted task").count()) === 1);
  await sleep(600);
  await page.reload();
  await title(page, "Buy milk").waitFor({ timeout: 8000 }).catch(() => {});
  check("capture: reload does not duplicate", (await title(page, "Buy milk").count()) === 1);

  // ── E. Overdue group + ISO date ─────────────────────────────────────────────
  await quick.fill("Old thing 2020-01-01");
  await quick.press("Enter");
  await title(page, "Old thing").waitFor();
  check("overdue group is shown", (await page.getByText(/^Overdue · \d+/i).count()) >= 1);

  // ── F. Import modal (paste a Notes list) ────────────────────────────────────
  await page.getByRole("button", { name: /Import/ }).first().click();
  await page.locator("textarea").fill("• Note item one\n• Note item two today\n☑ already done\n1. Note item three !low");
  check("import preview shows 3 (checked item skipped)", (await page.locator("ul li").filter({ hasText: "Note item" }).count()) === 3);
  await page.getByRole("button", { name: /^Add 3 tasks$/ }).click();
  await title(page, "Note item three").waitFor();
  check("import added tasks", (await title(page, "Note item one").count()) === 1);

  // ── G. Backup roundtrip ────────────────────────────────────────────────────
  await page.goto(BASE + "/settings/");
  await page.getByRole("button", { name: /Export backup/ }).waitFor();
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Export backup/ }).click()]);
  const file = path.join(dir, "backup.json");
  await dl.saveAs(file);
  const backup = JSON.parse(fs.readFileSync(file, "utf8"));
  check("backup has tasks and no secrets", backup.app === "taskflow" && backup.tasks.length >= 8 && !JSON.stringify(backup).includes("token"), `${backup.tasks.length} tasks`);
  await page.locator('input[type="file"]').setInputFiles(file);
  await page.getByText(/Imported 0 tasks/).waitFor({ timeout: 5000 }).catch(() => {});
  check("re-import merges without duplicates", await page.getByText(/Imported 0 tasks/).isVisible());

  // ── H. Telegram with a mocked Bot API ──────────────────────────────────────
  const tgState = { updates: [], nextId: 1, sent: [], webhookDeleted: false };
  const push = (chatId, text) => tgState.updates.push({ update_id: tgState.nextId++, message: { message_id: tgState.nextId, from: { id: chatId, is_bot: false }, chat: { id: chatId, type: "private" }, text } });
  await page.route("https://api.telegram.org/**", async (route) => {
    const method = new URL(route.request().url()).pathname.split("/").pop();
    const body = new URLSearchParams(route.request().postData() || "");
    let result = true;
    if (method === "getMe") result = { id: 1, is_bot: true, username: "testbot" };
    if (method === "deleteWebhook") tgState.webhookDeleted = true;
    if (method === "getUpdates") result = tgState.updates.filter((u) => u.update_id >= Number(body.get("offset") || 0));
    if (method === "sendMessage") tgState.sent.push({ chat: Number(body.get("chat_id")), text: body.get("text") });
    await route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "content-type": "application/json" }, body: JSON.stringify({ ok: true, result }) });
  });

  await page.reload();
  await page.getByPlaceholder("123456789:AA…").fill(TOKEN);
  await page.getByRole("button", { name: /Connect bot/ }).click();
  await page.getByText("@testbot").first().waitFor({ timeout: 5000 });
  check("telegram: webhook removed on connect", tgState.webhookDeleted);
  const codeText = await page.locator("code", { hasText: "/link " }).first().innerText();
  const code = codeText.replace("/link", "").trim();
  check("telegram: pairing code shown", /^[A-Z2-9]{8}$/.test(code), code);

  push(999, "/link " + code); // a stranger tries the code from another chat id... (valid code, so this WOULD link) — send wrong code first
  tgState.updates.pop();
  push(999, "/link WRONGCOD");
  push(999, "Hacker task");
  push(777, "/start link_" + code);
  await page.getByText(/Connected to/).waitFor({ timeout: 15000 }).catch(() => {});
  check("telegram: linked with the right code only", await page.getByText(/Connected to/).isVisible());
  push(999, "Stranger task after link");
  push(777, "Telegram task tomorrow !high\nSecond telegram line");
  push(777, "/help");
  await page.getByRole("button", { name: /Sync now/ }).click();
  await sleep(800);
  await page.goto(BASE + "/dashboard/");
  await title(page, "Telegram task").waitFor({ timeout: 8000 }).catch(() => {});
  check("telegram: owner's lines became tasks", (await title(page, "Telegram task").count()) === 1 && (await title(page, "Second telegram line").count()) === 1);
  check("telegram: strangers ignored", (await title(page, "Hacker task").count()) === 0 && (await title(page, "Stranger task").count()) === 0);
  check("telegram: confirmation + help replies sent to owner only", tgState.sent.some((s) => s.chat === 777 && /Added 2 tasks/.test(s.text)) && tgState.sent.some((s) => s.chat === 777 && /TaskFlow bot/.test(s.text)) && tgState.sent.filter((s) => s.chat !== 777).every((s) => /To link this chat|not the current one/.test(s.text)));

  // ── I. Sign out stays signed out; capture survives sign-in ─────────────────
  await page.locator("header button").filter({ has: page.locator("div.bg-primary") }).click();
  await page.getByRole("button", { name: "Sign Out" }).click();
  await page.getByRole("button", { name: "Sign Out" }).click();
  await page.waitForURL(/login/);
  await sleep(1200);
  check("logout: stays on /login (no bounce back)", /login/.test(page.url()), page.url());
  await page.goto(BASE + "/dashboard/?add=" + encodeURIComponent("Stashed while signed out"));
  await page.waitForURL(/login/);
  await page.fill('input[type="text"]', "Test User");
  await page.click('button[type="submit"]');
  await title(page, "Stashed while signed out").waitFor({ timeout: 8000 }).catch(() => {});
  check("signed-out capture is replayed after login", (await title(page, "Stashed while signed out").count()) === 1);
  check("old tasks still there after re-login", (await title(page, "Persisted task").count()) === 1);

  check("no page errors", page.errors.length === 0, page.errors.slice(0, 3).join(" | "));
  await ctx.close();
  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error("TEST CRASHED", e); process.exit(2); });
