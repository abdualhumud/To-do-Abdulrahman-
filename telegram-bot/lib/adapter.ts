import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { Result } from "./core";

export function header(req: VercelRequest, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

export function headerMap(req: VercelRequest): Record<string, string | undefined> {
  return Object.fromEntries(Object.keys(req.headers).map((k) => [k, header(req, k)]));
}

export function send(res: VercelResponse, result: Result): void {
  for (const [k, v] of Object.entries(result.headers ?? {})) res.setHeader(k, v);
  if (result.body === null) {
    res.status(result.status).end();
    return;
  }
  res.status(result.status).json(result.body);
}

/** Wraps a handler so an unexpected error becomes a JSON 500 (never an HTML crash page). */
export function safely(fn: (req: VercelRequest) => Promise<Result>) {
  return async (req: VercelRequest, res: VercelResponse): Promise<void> => {
    try {
      send(res, await fn(req));
    } catch (e) {
      console.error(e);
      res.status(500).json({ ok: false, error: e instanceof Error ? e.message : "Server error" });
    }
  };
}
