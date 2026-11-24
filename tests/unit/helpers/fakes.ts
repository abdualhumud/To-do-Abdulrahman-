// In-memory stand-ins for Upstash Redis (REST), the Telegram Bot API and Resend.
// Shared by the unit tests and the browser-test harness.

export class FakeRedis {
  kv = new Map<string, string>();
  lists = new Map<string, string[]>();
  hashes = new Map<string, Map<string, string>>();
  zsets = new Map<string, Map<string, number>>();

  clear(): void {
    this.kv.clear();
    this.lists.clear();
    this.hashes.clear();
    this.zsets.clear();
  }

  run(cmd: (string | number)[]): unknown {
    const [rawName, ...a] = cmd;
    const name = String(rawName).toUpperCase();
    const k = String(a[0]);
    const hash = () => this.hashes.get(k) ?? new Map<string, string>();
    const zset = () => this.zsets.get(k) ?? new Map<string, number>();
    switch (name) {
      case "PING": return "PONG";
      case "GET": return this.kv.get(k) ?? null;
      case "SET": {
        if (a.slice(2).some((x) => String(x).toUpperCase() === "NX") && this.kv.has(k)) return null;
        this.kv.set(k, String(a[1]));
        return "OK";
      }
      case "GETDEL": { const v = this.kv.get(k) ?? null; this.kv.delete(k); return v; }
      case "DEL": return a.reduce<number>((n, key) => {
        const s = String(key);
        return n + Number([this.kv.delete(s), this.lists.delete(s), this.hashes.delete(s), this.zsets.delete(s)].some(Boolean));
      }, 0);
      case "EXISTS": return this.kv.has(k) || this.lists.has(k) || this.hashes.has(k) ? 1 : 0;
      case "INCR": { const v = Number(this.kv.get(k) ?? 0) + 1; this.kv.set(k, String(v)); return v; }
      case "EXPIRE": return 1;
      case "RPUSH": { const l = this.lists.get(k) ?? []; l.push(...a.slice(1).map(String)); this.lists.set(k, l); return l.length; }
      case "LRANGE": {
        const l = this.lists.get(k) ?? [];
        const s = Number(a[1]);
        let e = Number(a[2]);
        if (e < 0) e = l.length + e;
        return l.slice(s < 0 ? l.length + s : s, e + 1);
      }
      case "LTRIM": {
        const l = this.lists.get(k) ?? [];
        let s = Number(a[1]);
        let e = Number(a[2]);
        if (s < 0) s = Math.max(l.length + s, 0);
        if (e < 0) e = l.length + e;
        const out = l.slice(s, e + 1);
        if (out.length) this.lists.set(k, out); else this.lists.delete(k);
        return "OK";
      }
      case "HSET": {
        const h = this.hashes.get(k) ?? new Map<string, string>();
        let added = 0;
        for (let i = 1; i + 1 < a.length; i += 2) { if (!h.has(String(a[i]))) added++; h.set(String(a[i]), String(a[i + 1])); }
        this.hashes.set(k, h);
        return added;
      }
      case "HGET": return hash().get(String(a[1])) ?? null;
      case "HGETALL": return [...hash().entries()].flat();
      case "HKEYS": return [...hash().keys()];
      case "HLEN": return hash().size;
      case "HDEL": {
        const h = this.hashes.get(k);
        if (!h) return 0;
        const n = a.slice(1).reduce<number>((c, f) => c + Number(h.delete(String(f))), 0);
        if (h.size === 0) this.hashes.delete(k);
        return n;
      }
      case "ZADD": { const z = this.zsets.get(k) ?? new Map<string, number>(); z.set(String(a[2]), Number(a[1])); this.zsets.set(k, z); return 1; }
      case "ZREM": { const z = this.zsets.get(k); return z && z.delete(String(a[1])) ? 1 : 0; }
      case "ZRANGEBYSCORE": {
        const lo = String(a[1]) === "-inf" ? -Infinity : Number(a[1]);
        const hi = String(a[2]) === "+inf" ? Infinity : Number(a[2]);
        let rows = [...zset().entries()].filter(([, s]) => s >= lo && s <= hi).sort((x, y) => x[1] - y[1] || x[0].localeCompare(y[0]));
        const li = a.findIndex((x) => String(x).toUpperCase() === "LIMIT");
        if (li >= 0) rows = rows.slice(Number(a[li + 1]), Number(a[li + 1]) + Number(a[li + 2]));
        return a.some((x) => String(x).toUpperCase() === "WITHSCORES") ? rows.flatMap(([m, s]) => [m, String(s)]) : rows.map(([m]) => m);
      }
      default: throw new Error(`fake redis: unsupported ${name}`);
    }
  }

  /** Handles an Upstash REST request: POST / (one command) or POST /pipeline (array of commands). */
  http(path: string, body: unknown): { status: number; json: unknown } {
    try {
      if (path.endsWith("/pipeline")) return { status: 200, json: (body as (string | number)[][]).map((c) => ({ result: this.run(c) })) };
      return { status: 200, json: { result: this.run(body as (string | number)[]) } };
    } catch (e) {
      return { status: 200, json: { error: String(e) } };
    }
  }
}

export class FakeTelegram {
  constructor(readonly token: string) {}
  webhookUrl = "";
  sent: { chat: number; text: string }[] = [];

  /** Returns the Bot API reply, or null for an unknown token (HTTP 401). */
  call(token: string, method: string, params: URLSearchParams): { ok: boolean; result?: unknown; description?: string } {
    if (token !== this.token) return { ok: false, description: "Unauthorized" };
    switch (method) {
      case "getMe": return { ok: true, result: { username: "taskflow_test_bot" } };
      case "setWebhook": this.webhookUrl = params.get("url") ?? ""; return { ok: true, result: true };
      case "getWebhookInfo": return { ok: true, result: { url: this.webhookUrl } };
      case "sendMessage": this.sent.push({ chat: Number(params.get("chat_id")), text: params.get("text") ?? "" }); return { ok: true, result: {} };
      default: return { ok: true, result: true };
    }
  }
}

export class FakeResend {
  emails: { to: string[]; subject: string; text: string; auth: string }[] = [];
  reject = false;
  send(auth: string, body: { to: string[]; subject: string; text: string }): { status: number; json: unknown } {
    if (this.reject) return { status: 403, json: { message: "domain not verified" } };
    this.emails.push({ to: body.to, subject: body.subject, text: body.text, auth });
    return { status: 200, json: { id: "email_1" } };
  }
}
