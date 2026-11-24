import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCsp, extraBotOrigins } from "../../src/lib/csp.ts";

const connect = (csp: string) => csp.split("; ").find((d) => d.startsWith("connect-src "))!;

test("defaults allow Telegram and the Cloudflare/Vercel bot hosts only", () => {
  assert.equal(connect(buildCsp()), "connect-src 'self' https://api.telegram.org https://*.workers.dev https://*.vercel.app");
});

test("extra origins are appended and de-duplicated", () => {
  assert.equal(connect(buildCsp("https://bot.example.com https://bot.example.com")), "connect-src 'self' https://api.telegram.org https://*.workers.dev https://*.vercel.app https://bot.example.com");
});

test("invalid or dangerous entries are dropped", () => {
  const bad = "http://insecure.example.com * https://x.com;script-src 'unsafe-eval' https://localhost https://a.b/path https://ok.example.org:8443";
  assert.deepEqual(extraBotOrigins(bad), ["https://ok.example.org:8443"]);
  const csp = buildCsp(bad);
  assert.ok(!csp.includes("unsafe-eval") && !csp.includes("x.com"));
  assert.equal(csp.split("; ").filter((d) => d.startsWith("script-src")).length, 1); // no injected directive
});

test("the rest of the policy is unchanged", () => {
  const csp = buildCsp();
  for (const d of ["default-src 'self'", "object-src 'none'", "base-uri 'self'", "upgrade-insecure-requests"]) assert.ok(csp.includes(d), d);
});
