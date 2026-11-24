/**
 * One routing table for every host (Vercel functions, the Cloudflare Worker, the test harness):
 * the platform wrappers only translate their request into a RouteCtx and the Result back.
 */

import type { Env, Result } from "./infra";
import { handleInbox, handlePair, handleSetup, handleStatus, handleWebhook } from "./core";
import { handleSync } from "./sync";
import { handleCron, handleFeed, handleFeedCreate, handlePush, handleReminders, type Deps } from "./reminders";

export interface RouteCtx {
  env: Env;
  method: string;
  headers: Record<string, string | undefined>; // lower-case names
  query: Record<string, string | undefined>;
  body: unknown;
  host: string;
  now: number;
  deps?: Deps;
}

export async function route(name: string, c: RouteCtx): Promise<Result | null> {
  switch (name) {
    case "webhook":
      return c.method === "POST" ? handleWebhook(c.env, c.headers, c.body) : { status: 200, body: { ok: true, service: "TaskFlow Telegram bot" } };
    case "pair": return handlePair(c.env, c.method, c.body);
    case "inbox": return handleInbox(c.env, c.method, c.headers, c.body);
    case "status": return handleStatus(c.env, c.method);
    case "setup": return handleSetup(c.env, c.query, c.host);
    case "reminders": return handleReminders(c.env, c.method, c.headers, c.query, c.body, c.now, c.deps);
    case "push": return handlePush(c.env, c.method, c.headers, c.body);
    case "sync": return handleSync(c.env, c.method, c.headers, c.query, c.body);
    case "cron": return handleCron(c.env, c.headers, c.query, c.now, c.deps);
    case "feed": return c.method === "POST" ? handleFeedCreate(c.env, c.headers, c.host) : handleFeed(c.env, c.query.k ?? "", c.now);
    default: return null;
  }
}

/** The clock for a request. The `x-test-now` header is honoured ONLY when ALLOW_TEST_CLOCK=1 (tests). */
export function clockNow(env: Env, headers: Record<string, string | undefined>): number {
  const forced = Number(headers["x-test-now"]);
  return env.testMode && Number.isFinite(forced) && forced > 0 ? forced : Date.now();
}

/** Test-only helpers (`/__redis`, `/__reset`); inert unless ALLOW_TEST_CLOCK=1. */
export async function testRoute(env: Env, path: string, body: unknown): Promise<Result | null> {
  if (!env.testMode || !env.store) return null;
  if (path === "/__redis") {
    const command = typeof body === "string" ? JSON.parse(body) : body;
    return { status: 200, body: { result: await env.store.run(command as (string | number)[]) } };
  }
  if (path === "/__reset") {
    await env.store.run(["FLUSHALL"]);
    return { status: 200, body: { ok: true } };
  }
  return null;
}
