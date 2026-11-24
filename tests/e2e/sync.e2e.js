// Two real browser profiles = two devices. Tasks must flow both ways through the encrypted vault.
const { chromium } = require("playwright");
const fs = require("fs");
const os = require("os");
const path = require("path");

const BASE = "http://localhost:4173/To-do-Abdulrahman-";
const B = "http://127.0.0.1:4303";
const T = "http://127.0.0.1:4302";
const pushTg = (chat, text) => fetch(`${T}/__push`, { method: "POST", body: JSON.stringify({ chat, text }) });
let failures = 0;
const check = (name, ok, extra = "") => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`); };
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type", "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS" };
const title = (page, text) => page.locator("p.font-medium", { hasText: text });
const toastText = async (page) => (await page.locator('[role="status"]').allInnerTexts()).join(" | ");

const seen = []; // every request body sent to /api/sync by any device

async function device(label, dir) {
  const ctx = await chromium.launchPersistentContext(dir ?? fs.mkdtempSync(path.join(os.tmpdir(), `tf-sync-${label}-`)), { headless: true });
  await ctx.route("https://taskflow-bot.vercel.app/**", async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    if (u.pathname === "/api/sync") seen.push({ label, op: u.searchParams.get("op"), body: req.postData() ?? "" });
    const resp = await route.fetch({ url: `${B}${u.pathname}${u.search}`, headers: { ...req.headers(), "x-forwarded-host": "taskflow-bot.vercel.app" } });
    await route.fulfill({ response: resp, headers: { ...resp.headers(), ...CORS } });
  });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  return { ctx, page, errors };
}

async function register(page, name) {
  await page.goto(BASE + "/register/");
  await page.fill('input[type="text"]', name);
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard/);
}

const addTask = async (page, text) => {
  await page.goto(BASE + "/dashboard/");
  const quick = page.locator('input[placeholder^="Quick add"]');
  await quick.fill(text);
  await quick.press("Enter");
};

const syncNow = async (page) => {
  await page.goto(BASE + "/settings/");
  await page.locator("#sync").getByRole("button", { name: /Sync now/ }).click();
  await page.locator("#sync").getByText("Up to date").waitFor({ timeout: 15000 });
};

(async () => {
  const dirA = fs.mkdtempSync(path.join(os.tmpdir(), "tf-sync-A-"));
  const A = await device("A", dirA);
  const Bd = await device("B");

  // ── device A turns sync on ────────────────────────────────────────────────
  await register(A.page, "Phone");
  // Vault creation is owner-only: link Telegram to the server first (proves ownership)
  await A.page.goto(BASE + "/settings/");
  await A.page.getByLabel("Bot server address").fill("taskflow-bot.vercel.app");
  await A.page.getByRole("button", { name: /Connect server/ }).click();
  const tgCode = (await A.page.locator("code", { hasText: "/link " }).first().innerText()).replace("/link", "").trim();
  await pushTg(4242, "/start link_" + tgCode);
  await A.page.getByText(/Connected to/).waitFor({ timeout: 15000 });
  await A.page.goto(BASE + "/settings/");
  check("sync card offers both choices", (await A.page.getByRole("button", { name: "Turn on sync" }).count()) === 1 && (await A.page.getByRole("button", { name: "Join" }).count()) === 1);
  await A.page.getByLabel("Server address", { exact: true }).fill("taskflow-bot.vercel.app");
  await A.page.getByRole("button", { name: "Turn on sync" }).click();
  await A.page.locator("#sync").getByText("Up to date").waitFor({ timeout: 15000 });
  check("device A: sync is on and up to date", true);

  await addTask(A.page, "Buy secret milk tomorrow !high");
  await title(A.page, "Buy secret milk").waitFor();

  // ── pair device B with a one-time code ────────────────────────────────────
  await A.page.goto(BASE + "/settings/");
  await A.page.getByRole("button", { name: "Add a device" }).click();
  const code = (await A.page.locator("code.tracking-widest").innerText()).trim();
  check("pairing code looks like XXXX-XXXX-XXXX", /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code), code);

  await register(Bd.page, "Laptop");
  await Bd.page.goto(BASE + "/settings/");
  await Bd.page.getByLabel("Server address", { exact: true }).fill("taskflow-bot.vercel.app");
  await Bd.page.getByRole("button", { name: "Turn on sync" }).click();
  await Bd.page.getByText(/First connect Telegram to this server/).waitFor({ timeout: 8000 });
  check("a device that did not prove ownership cannot create a vault", true);
  await Bd.page.getByLabel("Pairing code").fill("AAAA-AAAA-AAAA");
  await Bd.page.getByLabel("Server address", { exact: true }).fill("taskflow-bot.vercel.app");
  await Bd.page.getByRole("button", { name: "Join" }).click();
  await Bd.page.getByText(/wrong, expired or already used/).waitFor({ timeout: 8000 });
  check("a wrong code is refused with a clear message", true);

  await Bd.page.getByLabel("Pairing code").fill(code.toLowerCase());
  await Bd.page.getByRole("button", { name: "Join" }).click();
  await Bd.page.locator("#sync").getByText("Up to date").waitFor({ timeout: 20000 });
  await Bd.page.goto(BASE + "/dashboard/");
  await title(Bd.page, "Buy secret milk").waitFor({ timeout: 10000 });
  check("device B received A's task after joining", true);

  const third = await device("C");
  await register(third.page, "Tablet");
  await third.page.goto(BASE + "/settings/");
  await third.page.getByLabel("Pairing code").fill(code);
  await third.page.getByLabel("Server address", { exact: true }).fill("taskflow-bot.vercel.app");
  await third.page.getByRole("button", { name: "Join" }).click();
  await third.page.getByText(/wrong, expired or already used/).waitFor({ timeout: 8000 });
  check("the code works only once", true);
  await third.ctx.close();

  // ── changes flow both ways ────────────────────────────────────────────────
  await addTask(Bd.page, "Water the plants");
  await title(Bd.page, "Water the plants").waitFor();
  await Bd.page.waitForTimeout(1500); // pushes ~1s after an edit
  await syncNow(A.page);
  await A.page.goto(BASE + "/dashboard/");
  await title(A.page, "Water the plants").waitFor({ timeout: 10000 });
  check("a task made on B shows up on A", true);

  await A.page.locator("div.group", { has: title(A.page, "Buy secret milk") }).first().hover();
  await A.page.getByLabel("Delete task").first().click({ force: true });
  await A.page.waitForTimeout(1500);
  await syncNow(Bd.page);
  await Bd.page.goto(BASE + "/dashboard/");
  await title(Bd.page, "Water the plants").waitFor();
  check("a deletion on A removes the task on B", (await title(Bd.page, "Buy secret milk").count()) === 0);

  // ── privacy: the server never saw plaintext ──────────────────────────────
  const blob = seen.map((s) => s.body).join("\n");
  check("requests carry ciphertext only (no task titles)", !/milk|plants|Water|Phone|Laptop/i.test(blob));
  check("the vault key never left a device", !/"key":"[A-Za-z0-9_-]{43}"/.test(blob));

  // ── restart: state persists and nothing is re-uploaded ───────────────────
  await A.ctx.close();
  const A2 = await device("A", dirA);
  await A2.page.goto(BASE + "/settings/");
  await A2.page.locator("#sync").getByText("Up to date").waitFor({ timeout: 15000 });
  await A2.page.goto(BASE + "/dashboard/");
  await title(A2.page, "Water the plants").waitFor();
  const restartPushes = seen.filter((s) => s.label === "A" && s.op === "exchange").slice(-3).map((s) => JSON.parse(s.body).push.length);
  check("after a browser restart A is still synced and re-uploads nothing", restartPushes[restartPushes.length - 1] === 0, `pushes: ${restartPushes}`);

  // ── turning sync off ─────────────────────────────────────────────────────
  await A2.page.goto(BASE + "/settings/");
  await A2.page.getByRole("button", { name: /Turn off sync/ }).click(); // dialogs auto-accept = delete server copy
  await A2.page.getByRole("button", { name: "Turn on sync" }).waitFor({ timeout: 8000 });
  check("turning sync off keeps the local tasks", (await (async () => { await A2.page.goto(BASE + "/dashboard/"); return title(A2.page, "Water the plants").count(); })()) === 1);
  await Bd.page.goto(BASE + "/settings/");
  await Bd.page.locator("#sync").getByRole("button", { name: /Sync now/ }).click();
  await Bd.page.getByText(/no longer\)? allowed|removed from sync/).waitFor({ timeout: 10000 });
  check("device B is told the vault is gone", true);

  const errs = [...A.errors, ...Bd.errors, ...A2.errors];
  check("no page errors", errs.length === 0, errs.join(" | "));
  await A2.ctx.close();
  await Bd.ctx.close();
  console.log(failures === 0 ? "\nsync.e2e: ALL PASSED" : `\nsync.e2e: ${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
