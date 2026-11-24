const { chromium } = require("playwright");
const fs = require("fs");
const os = require("os");
const path = require("path");

const BASE = "http://localhost:4173/To-do-Abdulrahman-";
const T = "http://127.0.0.1:4302";
const B = "http://127.0.0.1:4303";
const OWNER = 777;
let failures = 0;
const check = (name, ok, extra = "") => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = (p) => fetch(T + p).then((r) => r.json());
const push = (chat, text) => fetch(`${T}/__push`, { method: "POST", body: JSON.stringify({ chat, text }) }).then((r) => r.json());
const redis = (cmd) => fetch(`${T}/__redis`, { method: "POST", body: JSON.stringify(cmd) }).then((r) => r.json()).then((j) => j.result);
const cron = (shiftMinutes) => fetch(`${T}/__cron?shiftMinutes=${shiftMinutes}`).then((r) => r.json());
const title = (page, text) => page.locator("p.font-medium", { hasText: text });
const toastText = async (page) => (await page.locator('[role="status"]').allInnerTexts()).join(" | ");
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type", "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS" };
const pad = (n) => String(n).padStart(2, "0");
const localInput = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const minutesUntil = (target) => Math.ceil((target - Date.now()) / 60000) + 1;

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tf-rem-"));
  const ctx = await chromium.launchPersistentContext(dir, { headless: true, acceptDownloads: true });
  const errors = [];
  await ctx.route("https://taskflow-bot.vercel.app/**", async (route) => {
    const u = new URL(route.request().url());
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    const resp = await route.fetch({ url: `${B}${u.pathname}${u.search}`, headers: { ...route.request().headers(), "x-forwarded-host": "taskflow-bot.vercel.app" } });
    await route.fulfill({ response: resp, headers: { ...resp.headers(), ...CORS } });
  });
  await ctx.route("https://outlook.office.com/**", (route) => route.fulfill({ status: 200, body: "outlook" }));
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());

  // ── connect the bot server and link Telegram ───────────────────────────────
  await page.goto(BASE + "/register/");
  await page.fill('input[type="text"]', "Tester");
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard/);
  await page.goto(BASE + "/settings/");
  await page.getByLabel("Bot server address").fill("taskflow-bot.vercel.app");
  await page.getByRole("button", { name: /Connect server/ }).click();
  const code = (await page.locator("code", { hasText: "/link " }).first().innerText()).replace("/link", "").trim();
  await push(OWNER, "/start link_" + code);
  await page.getByText(/Connected to/).waitFor({ timeout: 15000 });

  // ── reminders card: opt-in sync ────────────────────────────────────────────
  const syncBox = page.getByLabel(/Keep reminders on my server/);
  await syncBox.waitFor();
  check("sync is OFF until the user opts in", !(await syncBox.isChecked()));
  await syncBox.check();
  await page.getByText(/Server updated/).waitFor({ timeout: 8000 }).catch(() => {});
  check("opting in syncs and says what was stored", /Server updated/.test(await toastText(page)));
  check("email shows as configured (masked address)", (await page.getByText(/to o\*+@elm\.sa/).count()) > 0);

  // ── quick add with time → reminder, preview chip ───────────────────────────
  await page.goto(BASE + "/dashboard/");
  const quick = page.locator('input[placeholder^="Quick add"]');
  await quick.fill("Call mom tomorrow at 5pm");
  check("quick-add preview shows the parsed time", (await page.getByText("Will add as").isVisible()) && (await page.locator("span", { hasText: "17:00" }).count()) > 0);
  await quick.press("Enter");
  await title(page, "Call mom").waitFor();
  check("task title is clean (time and date words removed)", (await title(page, "Call mom").first().innerText()).trim().endsWith("Call mom"));
  check("card shows a reminder badge with the time", (await page.locator('[title="Reminder"]', { hasText: "17:00" }).count()) === 1);

  const tomorrow5 = new Date();
  tomorrow5.setDate(tomorrow5.getDate() + 1);
  tomorrow5.setHours(17, 0, 0, 0);
  await sleep(3000); // debounce + request
  let due = await redis(["ZRANGEBYSCORE", "due", "-inf", "+inf", "WITHSCORES"]);
  check("server scheduled the reminder for exactly 17:00 tomorrow", due.length === 2 && Number(due[1]) === tomorrow5.getTime(), `${due[1]} vs ${tomorrow5.getTime()}`);

  // ── scheduler: Telegram delivery, no refire ────────────────────────────────
  await fetch(`${T}/__clear-sent`);
  let run = await cron(minutesUntil(tomorrow5.getTime()));
  check("cron fires the reminder", run.fired === 1, JSON.stringify(run));
  const msgs = await get("/__sent");
  check("Telegram message arrives at the owner's chat with title and time", msgs.some((m) => m.chat === OWNER && /⏰ Call mom/.test(m.text) && /17:00/.test(m.text)), msgs.map((m) => m.text).join(" / ").slice(0, 100));
  run = await cron(minutesUntil(tomorrow5.getTime()) + 5);
  check("the same reminder is not sent twice", run.fired === 0 && (await get("/__sent")).filter((m) => /Call mom/.test(m.text)).length === 1);

  // ── modal: repeating reminder by email ─────────────────────────────────────
  await page.getByRole("button", { name: /New Task/ }).first().click();
  await page.getByPlaceholder("What needs to be done?").fill("Send report");
  await page.getByRole("switch", { name: /Remind me/ }).click();
  const nextMorning = new Date();
  nextMorning.setDate(nextMorning.getDate() + 1);
  nextMorning.setHours(8, 0, 0, 0);
  await page.locator("#reminder-at").fill(localInput(nextMorning));
  await page.locator("#reminder-repeat").selectOption("sun-thu");
  await page.getByRole("button", { name: "Telegram", pressed: true }).click(); // turn Telegram off
  await page.getByRole("button", { name: "Email", pressed: false }).click(); // email on
  await page.getByRole("button", { name: /Create Task/ }).click();
  await title(page, "Send report").waitFor();
  check("modal saved a repeating reminder (badge with repeat)", (await page.locator('[title="Reminder"]', { hasText: "08:00" }).count()) === 1);
  await sleep(3000);
  due = await redis(["ZRANGEBYSCORE", "due", "-inf", "+inf", "WITHSCORES"]);
  check("server scheduled it", due.length === 2 && Number(due[1]) === nextMorning.getTime());
  run = await cron(minutesUntil(nextMorning.getTime()));
  const emails = await get("/__emails");
  check("email delivered to the owner address only, with the task title", emails.length === 1 && emails[0].to[0] === "owner@elm.sa" && /Send report/.test(emails[0].subject), JSON.stringify(emails.map((e) => e.subject)));
  due = await redis(["ZRANGEBYSCORE", "due", "-inf", "+inf", "WITHSCORES"]);
  const nextOccurrence = Number(due[1]);
  const weekday = new Date(nextOccurrence).getDay();
  check("a repeating reminder is rescheduled to a later working day (Sun–Thu)", nextOccurrence > nextMorning.getTime() && [0, 1, 2, 3, 4].includes(weekday) && new Date(nextOccurrence).getHours() === 8, `${new Date(nextOccurrence).toString()}`);

  // ── calendar: .ics download and Outlook links ──────────────────────────────
  const card = page.locator("div.card", { has: title(page, "Call mom") });
  await card.hover();
  await card.getByRole("button", { name: "Add to calendar" }).click();
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Apple Calendar · Outlook app/ }).click()]);
  const icsPath = path.join(dir, "call-mom.ics");
  await dl.saveAs(icsPath);
  const ics = fs.readFileSync(icsPath, "utf8");
  check("downloaded .ics is a valid calendar with the event and an alarm", /^BEGIN:VCALENDAR\r\n/.test(ics) && /SUMMARY:Call mom/.test(ics) && /BEGIN:VALARM/.test(ics) && /END:VCALENDAR\r\n$/.test(ics));
  check("the .ics start time is the reminder time (UTC)", ics.includes(`DTSTART:${new Date(tomorrow5).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}`));

  await card.hover();
  await card.getByRole("button", { name: "Add to calendar" }).click();
  const href = await page.getByRole("link", { name: /Microsoft 365/ }).getAttribute("href");
  check("Outlook (Microsoft 365) link pre-fills subject and start", href.startsWith("https://outlook.office.com/calendar/0/deeplink/compose?") && /subject=Call\+mom/.test(href) && /startdt=/.test(href), href.slice(0, 90));
  await page.keyboard.press("Escape");

  // ── calendar subscription feed ─────────────────────────────────────────────
  await page.goto(BASE + "/settings/");
  await page.getByRole("button", { name: /Create subscription link/ }).click();
  const feedUrl = await page.locator("code", { hasText: "/api/feed?k=" }).first().innerText();
  check("subscription link is shown (webcal button too)", /^https:\/\/taskflow-bot\.vercel\.app\/api\/feed\?k=[A-Za-z0-9]{32}$/.test(feedUrl) && (await page.getByRole("link", { name: "Open in Calendar app" }).getAttribute("href")).startsWith("webcal://taskflow-bot.vercel.app/api/feed"));
  const feedRes = await fetch(B + new URL(feedUrl).pathname + new URL(feedUrl).search);
  const feed = await feedRes.text();
  check("feed is text/calendar with both tasks and the repeat rule", feedRes.headers.get("content-type").includes("text/calendar") && /SUMMARY:Call mom/.test(feed) && /SUMMARY:Send report/.test(feed) && /RRULE:FREQ=WEEKLY;BYDAY=SU,MO,TU,WE,TH/.test(feed));
  check("feed link does not work with a wrong key", (await fetch(`${B}/api/feed?k=${"x".repeat(32)}`)).status === 404);

  // ── test buttons ───────────────────────────────────────────────────────────
  await fetch(`${T}/__clear-sent`);
  await page.getByRole("button", { name: /Send test/ }).first().click();
  await page.getByText(/Test sent/).first().waitFor({ timeout: 8000 }).catch(() => {});
  check("Telegram test message reaches the chat", (await get("/__sent")).some((m) => /TaskFlow test reminder/.test(m.text)));
  await page.getByRole("button", { name: /Send test/ }).nth(1).click();
  await sleep(1000);
  check("email test message is sent", (await get("/__emails")).some((e) => /TaskFlow test reminder/.test(e.subject)));
  check("phone row offers to enable this device", (await page.getByRole("button", { name: /Enable on this device/ }).count()) === 1);

  // ── deleting a task removes it from the feed; opting out wipes the server copy ─
  await page.goto(BASE + "/dashboard/");
  const callCard = page.locator("div.card", { has: title(page, "Call mom") });
  await callCard.hover();
  await callCard.getByRole("button", { name: "Delete task" }).click();
  await sleep(3000);
  check("a deleted task disappears from the calendar feed", !/SUMMARY:Call mom/.test(await (await fetch(B + new URL(feedUrl).pathname + new URL(feedUrl).search)).text()));
  await page.goto(BASE + "/settings/");
  await page.getByLabel(/Keep reminders on my server/).uncheck();
  await page.getByText(/server's copy was deleted/).waitFor({ timeout: 8000 }).catch(() => {});
  const emptyFeed = await (await fetch(B + new URL(feedUrl).pathname + new URL(feedUrl).search)).text();
  due = await redis(["ZRANGEBYSCORE", "due", "-inf", "+inf", "WITHSCORES"]);
  check("opting out deletes the server's copy and its schedule", !/SUMMARY:/.test(emptyFeed) && due.length === 0);

  // ── in-app alert (no server): fast-forward the page clock ───────────────────
  const p2 = await ctx.newPage();
  p2.on("pageerror", (e) => errors.push(e.message));
  await p2.clock.install({ time: new Date() });
  await p2.goto(BASE + "/dashboard/");
  const soon = new Date(Date.now() + 2 * 60_000);
  await p2.locator('input[placeholder^="Quick add"]').fill(`Check oven ${pad(soon.getHours())}:${pad(soon.getMinutes())}`);
  await p2.locator('input[placeholder^="Quick add"]').press("Enter");
  await title(p2, "Check oven").waitFor();
  // The toast lives 12 s, so advance the clock in small steps and look after each one.
  const target = new Date(soon);
  target.setSeconds(0, 0);
  await p2.clock.runFor(Math.max(target.getTime() - Date.now(), 0) + 1000);
  let alerted = false;
  for (let i = 0; i < 8 && !alerted; i++) {
    await p2.clock.runFor(5000);
    await sleep(150);
    alerted = (await p2.getByText(/⏰ Check oven/).count()) > 0;
  }
  check("in-app alert fires at the reminder time", alerted);

  check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  await ctx.close();
  console.log(failures === 0 ? "\nALL REMINDER CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error("TEST CRASHED", e); process.exit(2); });
