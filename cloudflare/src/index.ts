import { readEnv, type Env, type Result } from "../../telegram-bot/lib/infra";
import { clockNow, route, testRoute } from "../../telegram-bot/lib/routes";
import { runDue } from "../../telegram-bot/lib/reminders";
import { RedisDO } from "./store";

export { RedisDO };

interface Bindings {
  STORE: DurableObjectNamespace<RedisDO>;
  [name: string]: unknown;
}

function buildEnv(bindings: Bindings): Env {
  const env = readEnv(bindings as unknown as Record<string, string | undefined>);
  const store = bindings.STORE.get(bindings.STORE.idFromName("main"));
  env.store = { run: (command) => store.run(command), pipeline: (commands) => store.pipeline(commands) };
  return env;
}

function toResponse(result: Result): Response {
  const headers = new Headers(result.headers);
  if (result.body === null) return new Response(null, { status: result.status, headers });
  if (typeof result.body === "string") {
    headers.set("Content-Type", result.contentType ?? "text/plain; charset=utf-8");
    return new Response(result.body, { status: result.status, headers });
  }
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(result.body), { status: result.status, headers });
}

export default {
  async fetch(request: Request, bindings: Bindings): Promise<Response> {
    const env = buildEnv(bindings);
    const url = new URL(request.url);
    const headers: Record<string, string | undefined> = Object.fromEntries(request.headers);

    let body: unknown;
    if (request.method !== "GET" && request.method !== "HEAD") {
      const raw = await request.text();
      try {
        body = raw && (headers["content-type"] ?? "").includes("json") ? JSON.parse(raw) : raw || undefined;
      } catch {
        return toResponse({ status: 400, body: { ok: false, error: "Invalid JSON" }, headers: { "Access-Control-Allow-Origin": env.appOrigin } });
      }
    }

    const tested = await testRoute(env, url.pathname, body);
    if (tested) return toResponse(tested);

    const name = /^\/api\/(\w+)\/?$/.exec(url.pathname)?.[1];
    if (!name) return toResponse({ status: 200, body: { ok: true, service: "TaskFlow bot (Cloudflare Worker)" } });

    const result = await route(name, {
      env,
      method: request.method,
      headers,
      query: Object.fromEntries(url.searchParams),
      body,
      host: env.testMode ? (headers["x-forwarded-host"] ?? url.host) : url.host,
      now: clockNow(env, headers),
    }).catch((e: unknown) => {
      console.error(e);
      return { status: 500, body: { ok: false, error: "Server error" } };
    });
    return toResponse(result ?? { status: 404, body: { ok: false } });
  },

  // Every minute: send what is due, and drop expired keys.
  async scheduled(_event: ScheduledController, bindings: Bindings, ctx: ExecutionContext): Promise<void> {
    const env = buildEnv(bindings);
    ctx.waitUntil(
      (async () => {
        await runDue(env, Date.now());
        await env.store?.run(["PURGE"]);
      })(),
    );
  },
};
