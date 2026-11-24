// Browser end-to-end suites. Needs: `npm run build` (out/), Playwright with Chromium, network access to npm (tsx).
//   npm run build && npm run test:e2e            (Vercel handlers on Node, fake Redis)
//   npm run build && npm run test:e2e -- --worker (the Cloudflare Worker on workerd; needs `npm ci` in cloudflare/)
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const here = path.join(root, "tests/e2e");
const require = createRequire(import.meta.url);

try {
  require.resolve("playwright");
} catch {
  console.error("Playwright is not installed. Install it (npm i -g playwright && npx playwright install chromium) and retry.");
  process.exit(2);
}
if (!existsSync(path.join(root, "out/index.html"))) {
  console.error("Build output not found. Run `npm run build` first.");
  process.exit(2);
}

const children = [];
// detached = own process group, so `npx` and the `tsx` it spawns are both stopped on exit.
const start = (cmd, args) => {
  const child = spawn(cmd, args, { cwd: root, stdio: "ignore", detached: true });
  children.push(child);
  return child;
};
const stopAll = () =>
  children.forEach((c) => {
    try {
      process.kill(-c.pid);
    } catch {
      /* already gone */
    }
  });
process.on("exit", stopAll);

const waitFor = async (url) => {
  for (let i = 0; i < 60; i++) {
    try {
      await fetch(url);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`${url} did not start`);
};

for (const url of ["http://localhost:4173/", "http://127.0.0.1:4303/api/status", "http://127.0.0.1:4302/__sent"]) {
  const busy = await fetch(url).then(() => true, () => false);
  if (busy) {
    console.error(`${url} is already served by another process (a stale run?). Stop it and retry.`);
    process.exit(2);
  }
}

const workerMode = process.argv.includes("--worker");

start("node", [path.join(here, "serve.cjs"), path.join(root, "out"), "4173"]);
start("npx", ["--yes", "tsx", path.join(here, "fake-services.mts")]);
if (workerMode) {
  const wrangler = path.join(root, "cloudflare/node_modules/.bin/wrangler");
  if (!existsSync(wrangler)) {
    console.error("Run `npm ci` inside cloudflare/ first (installs wrangler / workerd).");
    process.exit(2);
  }
  writeFileSync(
    path.join(root, "cloudflare/.dev.vars"),
    [
      "TELEGRAM_BOT_TOKEN=123456789:AAHdqTcvCH1vGWJxfSeofSs0K38CIDabcde",
      "TELEGRAM_WEBHOOK_SECRET=test-webhook-secret",
      "CRON_SECRET=cron-secret",
      "RESEND_API_KEY=re_test",
      "REMINDER_EMAIL_TO=owner@elm.sa",
      "TELEGRAM_API_BASE=http://127.0.0.1:4302",
      "RESEND_API_BASE=http://127.0.0.1:4304",
      "ALLOW_TEST_CLOCK=1",
      "",
    ].join("\n"),
  );
  const persist = mkdtempSync(path.join(os.tmpdir(), "tf-worker-"));
  const worker = spawn(wrangler, ["dev", "--port", "4303", "--ip", "127.0.0.1", "--persist-to", persist], { cwd: path.join(root, "cloudflare"), stdio: "ignore", detached: true });
  children.push(worker);
} else {
  start("npx", ["--yes", "tsx", path.join(here, "bot-node.mts")]);
}
await waitFor("http://localhost:4173/To-do-Abdulrahman-/login/");
await waitFor("http://127.0.0.1:4302/__sent");
await waitFor("http://127.0.0.1:4303/api/status");
console.log(workerMode ? "bot server: Cloudflare Worker (workerd)" : "bot server: Vercel handlers on Node");

let failed = 0;
for (const suite of ["app.e2e.js", "telegram-browser.e2e.js", "telegram-server.e2e.js", "reminders.e2e.js", "sync.e2e.js"]) {
  console.log(`\n=== ${suite}`);
  await fetch("http://127.0.0.1:4302/__reset", { method: "POST" }); // clean bot state for every suite
  const r = spawnSync("node", [path.join(here, suite)], { cwd: root, stdio: "inherit" });
  if (r.status !== 0) failed++;
}
stopAll();
console.log(failed === 0 ? "\nALL E2E SUITES PASSED" : `\n${failed} E2E SUITE(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
