const { chromium } = require("playwright");
const fs = require("fs");
const os = require("os");
const path = require("path");

const BASE = "http://localhost:4173/To-do-Abdulrahman-";
const T = "http://127.0.0.1:4302";
const OWNER = 777;
let failures = 0;
const check = (name, ok, extra = "") => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const push = (chat, text) => fetch(`${T}/__push`, { method: "POST", body: JSON.stringify({ chat, text }) }).then((r) => r.json());
const sent = () => fetch(`${T}/__sent`).then((r) => r.json());
const title = (page, text) => page.locator("p.font-medium", { hasText: text });
const toastText = async (page) => (await page.locator('[role="status"]').allInnerTexts()).join(" | ");
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type", "access-control-allow-methods": "GET, POST, OPTIONS" };

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tf-srv-"));
  const ctx = await chromium.launchPersistentContext(dir, { headless: true });
  const errors = [];

  // The fake bot server lives on a *.vercel.app host (allowed by the app's CSP) and is routed to the local harness.
  await ctx.route("https://taskflow-bot.vercel.app/**", async (route) => {
    const u = new URL(route.request().url());
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const resp = await route.fetch({ url: `http://127.0.0.1:4303${u.pathname}${u.search}` });
    await route.fulfill({ response: resp, headers: { ...resp.headers(), ...CORS } });
  });
  await ctx.route("https://unreachable-bot.vercel.app/**", (route) => route.abort("failed"));
  await ctx.route("https://not-a-bot.vercel.app/**", (route) => route.fulfill({ status: 200, headers: { ...CORS, "content-type": "text/html" }, body: "<html>hello</html>" }));

  const page = ctx.pages()[0] ?? (await ctx.newPage());
  page.on("pageerror", (e) => errors.push(e.message));
  await fetch(`${T}/__reset`);

  await page.goto(BASE + "/register/");
  await page.fill('input[type="text"]', "Tester");
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard/);
  await page.goto(BASE + "/settings/");
  const serverInput = page.getByLabel("Bot server address");
  await serverInput.waitFor();

  // ── wrong addresses explain themselves ─────────────────────────────────────
  await serverInput.fill("unreachable-bot.vercel.app");
  await page.getByRole("button", { name: /Connect server/ }).click();
  await sleep(500);
  check("unreachable server: names the host", /Couldn't reach unreachable-bot\.vercel\.app/.test(await toastText(page)));
  await serverInput.fill("not-a-bot.vercel.app");
  await page.getByRole("button", { name: /Connect server/ }).click();
  await sleep(500);
  check("wrong address (HTML page): says it is not a bot server", /doesn't look like a TaskFlow bot server/.test(await toastText(page)));
  await serverInput.fill("http://insecure.example.com");
  await page.getByRole("button", { name: /Connect server/ }).click();
  await sleep(300);
  check("http:// address is refused", /must start with https/.test(await toastText(page)));

  // ── connect (address typed without https://) ───────────────────────────────
  await serverInput.fill("  taskflow-bot.vercel.app/  ");
  await page.getByRole("button", { name: /Connect server/ }).click();
  await page.getByText("@taskflow_test_bot").first().waitFor({ timeout: 8000 });
  let code = (await page.locator("code", { hasText: "/link " }).first().innerText()).replace("/link", "").trim();
  check("server connected, pairing code shown", /^[A-Z2-9]{8}$/.test(code), code);

  // ── new code works (server issues a fresh one) ─────────────────────────────
  await page.getByRole("button", { name: /New code/ }).click();
  await sleep(800);
  const code2 = (await page.locator("code", { hasText: "/link " }).first().innerText()).replace("/link", "").trim();
  check("'New code' fetches a fresh code from the server", /^[A-Z2-9]{8}$/.test(code2) && code2 !== code, code2);
  await push(OWNER, "/link " + code); // old code must not work
  check("old code is rejected by the server", (await sent()).some((m) => m.chat === OWNER && /wrong or expired/.test(m.text)));

  // ── link from Telegram (deep link form) ────────────────────────────────────
  await push(OWNER, "/start link_" + code2);
  await page.getByText(/Connected to/).waitFor({ timeout: 15000 }).catch(() => {});
  check("app notices the link and shows Connected (always-on server)", (await page.getByText(/always-on server/).count()) > 0 && (await page.getByText(/Connected to/).isVisible()));

  // ── THE POINT: app closed, bot still answers instantly and saves ────────────
  await page.goto("about:blank");
  await fetch(`${T}/__clear-sent`);
  await push(OWNER, "Server task one tomorrow !high");
  await push(OWNER, "اشتري خبز بكرة #صحة\nCall dentist Friday");
  const replies = await sent();
  check("bot replied instantly while the app was closed", replies.filter((m) => m.chat === OWNER && /Saved/.test(m.text)).length === 2, replies.map((m) => m.text).join(" / ").slice(0, 120));

  // ── open the app: tasks collected ──────────────────────────────────────────
  const p2 = await ctx.newPage();
  p2.on("pageerror", (e) => errors.push(e.message));
  await p2.goto(BASE + "/dashboard/");
  await title(p2, "Server task one").waitFor({ timeout: 10000 }).catch(() => {});
  check("tasks collected from the server on open", (await title(p2, "Server task one").count()) === 1 && (await title(p2, "اشتري خبز").count()) === 1 && (await title(p2, "Call dentist").count()) === 1);
  await sleep(1500);
  await p2.reload();
  await title(p2, "Server task one").waitFor({ timeout: 10000 }).catch(() => {});
  await sleep(6000);
  check("inbox was emptied: no duplicates after reload and more polls", (await title(p2, "Server task one").count()) === 1 && (await title(p2, "Call dentist").count()) === 1);

  // ── new message while the app is open arrives without any click ─────────────
  await push(OWNER, "Live while open");
  await p2.evaluate(() => window.dispatchEvent(new Event("focus")));
  await title(p2, "Live while open").waitFor({ timeout: 10000 }).catch(() => {});
  check("message while open appears", (await title(p2, "Live while open").count()) === 1);

  // ── diagnostics ────────────────────────────────────────────────────────────
  await p2.goto(BASE + "/settings/");
  await p2.getByRole("button", { name: /Check connection/ }).click();
  await p2.getByText(/Redis inbox/).waitFor({ timeout: 8000 }).catch(() => {});
  const diagOk = (await p2.getByText(/Server reachable/).isVisible()) && (await p2.getByText(/Telegram bot attached: @taskflow_test_bot/).isVisible()) && (await p2.getByText(/Redis inbox: Working/).isVisible()) && (await p2.getByText(/Chat linked: Yes/).isVisible());
  check("diagnostics: server, bot, redis, link all green", diagOk);

  // ── stranger never gets tasks in ───────────────────────────────────────────
  await push(999, "Hacker task");
  await sleep(500);
  await p2.evaluate(() => window.dispatchEvent(new Event("focus")));
  await sleep(2500);
  await p2.goto(BASE + "/dashboard/");
  await sleep(1500);
  check("stranger's message is not a task", (await title(p2, "Hacker task").count()) === 0);

  check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  await ctx.close();
  console.log(failures === 0 ? "\nALL APP↔SERVER CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error("TEST CRASHED", e); process.exit(2); });
