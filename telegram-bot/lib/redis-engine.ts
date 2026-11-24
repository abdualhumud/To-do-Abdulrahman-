/**
 * A small in-memory Redis: exactly the commands TaskFlow's server uses, with Redis semantics
 * (lists, hashes, sorted sets, lazy key expiry). Used
 *  - as the storage inside the Cloudflare Durable Object (state persisted per key via takeDirty()),
 *  - as the fake Redis in unit/e2e tests.
 * Single-threaded use only — a Durable Object serialises calls, which also makes ZREM-style
 * "claim" operations atomic.
 */

export type Entry =
  | { t: "s"; v: string; exp?: number }
  | { t: "l"; v: string[]; exp?: number }
  | { t: "h"; v: Record<string, string>; exp?: number }
  | { t: "z"; v: Record<string, number>; exp?: number };

export type Command = (string | number)[];

export class RedisEngine {
  protected data = new Map<string, Entry>();
  private dirty = new Set<string>();

  constructor(protected now: () => number = Date.now) {}

  /** Loads previously persisted entries (no dirty marking). */
  load(entries: Iterable<[string, Entry]>): void {
    for (const [k, e] of entries) this.data.set(k, e);
  }

  /** Keys changed since the last call: entries to write and keys to delete. */
  takeDirty(): { puts: [string, Entry][]; deletes: string[] } {
    const puts: [string, Entry][] = [];
    const deletes: string[] = [];
    for (const k of this.dirty) {
      const e = this.data.get(k);
      if (e) puts.push([k, e]);
      else deletes.push(k);
    }
    this.dirty.clear();
    return { puts, deletes };
  }

  clear(): void {
    for (const k of this.data.keys()) this.dirty.add(k);
    this.data.clear();
  }

  size(): number {
    return this.data.size;
  }

  private entry(key: string): Entry | undefined {
    const e = this.data.get(key);
    if (e?.exp !== undefined && e.exp <= this.now()) {
      this.data.delete(key);
      this.dirty.add(key);
      return undefined;
    }
    return e;
  }

  private write(key: string, e: Entry): void {
    this.data.set(key, e);
    this.dirty.add(key);
  }

  private remove(key: string): boolean {
    const had = this.data.delete(key);
    if (had) this.dirty.add(key);
    return had;
  }

  private typed<T extends Entry["t"]>(key: string, t: T): Extract<Entry, { t: T }> | undefined {
    const e = this.entry(key);
    if (e && e.t !== t) throw new Error("WRONGTYPE Operation against a key holding the wrong kind of value");
    return e as Extract<Entry, { t: T }> | undefined;
  }

  /** Removes expired keys; returns how many. */
  purge(): number {
    let n = 0;
    for (const k of [...this.data.keys()]) if (this.entry(k) === undefined) n++;
    return n;
  }

  run(cmd: Command): unknown {
    const [rawName, ...a] = cmd;
    const name = String(rawName).toUpperCase();
    const k = String(a[0]);
    const upper = (from: number) => a.slice(from).map((x) => String(x).toUpperCase());

    switch (name) {
      case "PING": return "PONG";
      case "FLUSHALL": this.clear(); return "OK";
      case "PURGE": return this.purge();

      case "GET": return this.typed(k, "s")?.v ?? null;
      case "SET": {
        const opts = upper(2);
        if (opts.includes("NX") && this.entry(k)) return null;
        const ex = opts.indexOf("EX");
        this.write(k, { t: "s", v: String(a[1]), ...(ex >= 0 ? { exp: this.now() + Number(a[2 + ex + 1]) * 1000 } : {}) });
        return "OK";
      }
      case "GETDEL": { const v = this.typed(k, "s")?.v ?? null; this.remove(k); return v; }
      case "INCR": {
        const e = this.typed(k, "s");
        const v = Number(e?.v ?? 0) + 1;
        this.write(k, { t: "s", v: String(v), ...(e?.exp !== undefined ? { exp: e.exp } : {}) });
        return v;
      }
      case "INCRBY": {
        const e = this.typed(k, "s");
        const v = Number(e?.v ?? 0) + Number(a[1]);
        this.write(k, { t: "s", v: String(v), ...(e?.exp !== undefined ? { exp: e.exp } : {}) });
        return v;
      }
      case "DEL": return a.reduce<number>((n, key) => n + Number(this.entry(String(key)) !== undefined && this.remove(String(key))), 0);
      case "EXISTS": return this.entry(k) ? 1 : 0;
      case "EXPIRE": {
        const e = this.entry(k);
        if (!e) return 0;
        this.write(k, { ...e, exp: this.now() + Number(a[1]) * 1000 } as Entry);
        return 1;
      }

      case "RPUSH": {
        const e = this.typed(k, "l");
        const v = [...(e?.v ?? []), ...a.slice(1).map(String)];
        this.write(k, { t: "l", v, ...(e?.exp !== undefined ? { exp: e.exp } : {}) });
        return v.length;
      }
      case "LRANGE": {
        const l = this.typed(k, "l")?.v ?? [];
        const s = Number(a[1]);
        let e = Number(a[2]);
        if (e < 0) e = l.length + e;
        return l.slice(s < 0 ? Math.max(l.length + s, 0) : s, e + 1);
      }
      case "LTRIM": {
        const cur = this.typed(k, "l");
        if (!cur) return "OK";
        let s = Number(a[1]);
        let e = Number(a[2]);
        if (s < 0) s = Math.max(cur.v.length + s, 0);
        if (e < 0) e = cur.v.length + e;
        const out = cur.v.slice(s, e + 1);
        if (out.length) this.write(k, { ...cur, v: out });
        else this.remove(k);
        return "OK";
      }

      case "HSET": {
        const e = this.typed(k, "h");
        const v = { ...(e?.v ?? {}) };
        let added = 0;
        for (let i = 1; i + 1 < a.length; i += 2) {
          if (!(String(a[i]) in v)) added++;
          v[String(a[i])] = String(a[i + 1]);
        }
        this.write(k, { t: "h", v, ...(e?.exp !== undefined ? { exp: e.exp } : {}) });
        return added;
      }
      case "HGET": return this.typed(k, "h")?.v[String(a[1])] ?? null;
      case "HGETALL": return Object.entries(this.typed(k, "h")?.v ?? {}).flat();
      case "HKEYS": return Object.keys(this.typed(k, "h")?.v ?? {});
      case "HLEN": return Object.keys(this.typed(k, "h")?.v ?? {}).length;
      case "HDEL": {
        const e = this.typed(k, "h");
        if (!e) return 0;
        const v = { ...e.v };
        const n = a.slice(1).reduce<number>((c, f) => (String(f) in v ? (delete v[String(f)], c + 1) : c), 0);
        if (Object.keys(v).length) this.write(k, { ...e, v });
        else this.remove(k);
        return n;
      }

      case "ZADD": {
        const e = this.typed(k, "z");
        this.write(k, { t: "z", v: { ...(e?.v ?? {}), [String(a[2])]: Number(a[1]) }, ...(e?.exp !== undefined ? { exp: e.exp } : {}) });
        return 1;
      }
      case "ZCARD": return Object.keys(this.typed(k, "z")?.v ?? {}).length;
      case "ZREM": {
        const e = this.typed(k, "z");
        const m = String(a[1]);
        if (!e || !(m in e.v)) return 0;
        const v = { ...e.v };
        delete v[m];
        if (Object.keys(v).length) this.write(k, { ...e, v });
        else this.remove(k);
        return 1;
      }
      case "ZRANGEBYSCORE": {
        const lo = String(a[1]) === "-inf" ? -Infinity : Number(a[1]);
        const hi = String(a[2]) === "+inf" ? Infinity : Number(a[2]);
        let rows = Object.entries(this.typed(k, "z")?.v ?? {})
          .filter(([, s]) => s >= lo && s <= hi)
          .sort((x, y) => x[1] - y[1] || x[0].localeCompare(y[0]));
        const opts = upper(3);
        const li = opts.indexOf("LIMIT");
        if (li >= 0) rows = rows.slice(Number(a[3 + li + 1]), Number(a[3 + li + 1]) + Number(a[3 + li + 2]));
        return opts.includes("WITHSCORES") ? rows.flatMap(([m, s]) => [m, String(s)]) : rows.map(([m]) => m);
      }

      default: throw new Error(`unsupported command ${name}`);
    }
  }
}
