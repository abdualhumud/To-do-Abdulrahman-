/**
 * Multi-device sync ("vault"). The server stores only ciphertext produced by the devices — it never
 * holds the encryption key — and arbitrates concurrent edits per item: highest (u, dev) wins, where
 * `u` is a hybrid-logical-clock stamp chosen by the editing device. Records get a server sequence
 * number so a device can ask for "everything since the last thing I saw".
 *
 * Redis layout (V = vault id):
 *   sv:V:auth     sha256(token)           sv:V:seq    last assigned sequence number
 *   sv:V:i:<key>  {u, dev, c, seq}        sv:V:log    zset  key → seq  (index of all items)
 *   syncpair:<lookup>  wrapped vault secrets for pairing a new device (10 min, single use)
 *   svcount       number of vaults on this server (capped by MAX_VAULTS)
 */

import { compareStamps, sha256Hex } from "./sync-shared";
import { type Env, type Result, isLinkedKey, json, limited, limitedByIp, missingConfig, pipeline, preflight, redis, safeEqual } from "./infra";

const VAULT_RE = /^[A-Za-z0-9_-]{22}$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const ITEM_KEY_RE = /^(task|tag|habit|completion):[A-Za-z0-9_-]{1,64}$/;
const DEVICE_RE = /^[A-Za-z0-9]{4,32}$/;
const LOOKUP_RE = /^[0-9a-f]{64}$/;

export { compareStamps, sha256Hex };

export const MAX_RECORD_CHARS = 16_000;
export const MAX_PUSH = 200;
export const MAX_PULL = 300;
export const MAX_ITEMS = 5_000;
const MAX_CLOCK_SKEW_MS = 24 * 3600 * 1000; // a device may not stamp edits more than a day ahead (it would become un-overwritable)
const PAIR_TTL_S = 600;

interface Record_ {
  u: number;
  dev: string;
  c: string;
  seq: number;
}

interface PushRecord {
  key: string;
  u: number;
  dev: string;
  c: string;
}

const k = (vault: string, suffix: string) => `sv:${vault}:${suffix}`;

async function authenticate(env: Env, headers: Record<string, string | undefined>): Promise<string | null> {
  const m = /^Bearer\s+([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/.exec(headers.authorization ?? "");
  if (!m) return null;
  const stored = (await redis(env, ["GET", k(m[1], "auth")])) as string | null;
  if (!stored || !safeEqual(await sha256Hex(m[2]), stored)) return null;
  return m[1];
}

function readPush(raw: unknown): PushRecord[] {
  if (!Array.isArray(raw)) return [];
  const out: PushRecord[] = [];
  for (const r of raw.slice(0, MAX_PUSH)) {
    const o = (r ?? {}) as Record<string, unknown>;
    if (
      typeof o.key === "string" && ITEM_KEY_RE.test(o.key) &&
      Number.isSafeInteger(o.u) && (o.u as number) > 0 && (o.u as number) < Date.now() + MAX_CLOCK_SKEW_MS &&
      typeof o.dev === "string" && DEVICE_RE.test(o.dev) &&
      typeof o.c === "string" && o.c.length > 0 && o.c.length <= MAX_RECORD_CHARS
    ) {
      out.push({ key: o.key, u: o.u as number, dev: o.dev, c: o.c });
    }
  }
  return out;
}

const parseRecord = (raw: unknown): Record_ | null => {
  try {
    return typeof raw === "string" ? (JSON.parse(raw) as Record_) : null;
  } catch {
    return null;
  }
};

async function create(env: Env, headers: Record<string, string | undefined>, body: unknown): Promise<Result> {
  const b = (body ?? {}) as { vaultId?: string; token?: string };
  if (!VAULT_RE.test(b.vaultId ?? "") || !TOKEN_RE.test(b.token ?? "")) return json(env, 400, { ok: false, error: "Invalid vault credentials" });
  if (await limitedByIp(env, "synccreate", headers, 5, 3600)) return json(env, 429, { ok: false, error: "Too many attempts, try again later" });
  // Only the server's owner may create vaults: the caller must present the key of a Telegram chat the owner linked.
  const key = /^Bearer\s+([A-Za-z0-9]{32})$/.exec(headers.authorization ?? "")?.[1];
  if (!key || !(await isLinkedKey(env, key))) {
    return json(env, 403, { ok: false, error: "Connect Telegram to this server first (Settings → Telegram → Always-on server). That proves you own it, so strangers can't fill it with data." });
  }
  const count = Number(((await redis(env, ["GET", "svcount"])) as string | null) ?? 0);
  if (count >= env.maxVaults) {
    return json(env, 403, { ok: false, error: `This server already hosts the maximum number of sync vaults (${env.maxVaults}). Raise MAX_VAULTS or delete an old vault.` });
  }
  const made = await redis(env, ["SET", k(b.vaultId!, "auth"), await sha256Hex(b.token!), "NX"]);
  if (made === null) return json(env, 409, { ok: false, error: "That vault already exists" });
  await redis(env, ["INCRBY", "svcount", 1]);
  return json(env, 200, { ok: true });
}

async function exchange(env: Env, vault: string, body: unknown): Promise<Result> {
  const b = (body ?? {}) as { since?: unknown; dev?: unknown; push?: unknown };
  const since = Number.isSafeInteger(b.since) && (b.since as number) >= 0 ? (b.since as number) : 0;
  const caller = typeof b.dev === "string" && DEVICE_RE.test(b.dev) ? b.dev : "";
  const pushes = readPush(b.push);

  const accepted: string[] = [];
  const rejected: string[] = [];
  if (pushes.length > 0) {
    const existing = (await pipeline(env, pushes.map((p) => ["GET", k(vault, `i:${p.key}`)]))) as unknown[];
    const winners: { p: PushRecord; isNew: boolean }[] = [];
    pushes.forEach((p, i) => {
      const ex = parseRecord(existing[i]);
      if (ex && compareStamps(p, ex) <= 0) rejected.push(p.key); // the server already has this or newer
      else winners.push({ p, isNew: !ex });
    });

    const newKeys = winners.filter((w) => w.isNew).length;
    if (newKeys > 0 && Number(await redis(env, ["ZCARD", k(vault, "log")])) + newKeys > MAX_ITEMS) {
      return json(env, 413, { ok: false, error: `This vault is full (${MAX_ITEMS} items).` });
    }
    if (winners.length > 0) {
      const end = Number(await redis(env, ["INCRBY", k(vault, "seq"), winners.length]));
      const commands = winners.flatMap(({ p }, i) => {
        const seq = end - winners.length + 1 + i;
        accepted.push(p.key);
        return [
          ["SET", k(vault, `i:${p.key}`), JSON.stringify({ u: p.u, dev: p.dev, c: p.c, seq } satisfies Record_)],
          ["ZADD", k(vault, "log"), seq, p.key],
        ];
      });
      await pipeline(env, commands);
    }
  }

  const flat = ((await redis(env, ["ZRANGEBYSCORE", k(vault, "log"), since + 1, "+inf", "WITHSCORES", "LIMIT", 0, MAX_PULL + 1])) as string[] | null) ?? [];
  const entries: { key: string; seq: number }[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) entries.push({ key: flat[i], seq: Number(flat[i + 1]) });
  const more = entries.length > MAX_PULL;
  const page = entries.slice(0, MAX_PULL);

  const records = page.length ? ((await pipeline(env, page.map((e) => ["GET", k(vault, `i:${e.key}`)]))) as unknown[]) : [];
  const changes = page.flatMap((e, i) => {
    const r = parseRecord(records[i]);
    return r && r.dev !== caller ? [{ key: e.key, seq: e.seq, u: r.u, dev: r.dev, c: r.c }] : []; // a device never needs its own writes back
  });
  const cursor = page.length ? page[page.length - 1].seq : Math.max(since, Number(((await redis(env, ["GET", k(vault, "seq")])) as string | null) ?? 0));
  return json(env, 200, { ok: true, accepted, rejected, changes, cursor, more });
}

async function wipe(env: Env, vault: string): Promise<Result> {
  for (;;) {
    const keys = ((await redis(env, ["ZRANGEBYSCORE", k(vault, "log"), "-inf", "+inf", "LIMIT", 0, 200])) as string[] | null) ?? [];
    if (keys.length === 0) break;
    await pipeline(env, [...keys.map((key) => ["DEL", k(vault, `i:${key}`)]), ...keys.map((key) => ["ZREM", k(vault, "log"), key])]);
  }
  await redis(env, ["DEL", k(vault, "log"), k(vault, "seq")]);
  if (Number(await redis(env, ["DEL", k(vault, "auth")])) === 1) await redis(env, ["INCRBY", "svcount", -1]); // only the call that really removed it counts
  return json(env, 200, { ok: true });
}

/** One endpoint, selected by `?op=`: create · join (no auth) · exchange · info · pair · delete. */
export async function handleSync(
  env: Env,
  method: string,
  headers: Record<string, string | undefined>,
  query: Record<string, string | undefined>,
  body: unknown,
): Promise<Result> {
  if (method === "OPTIONS") return preflight(env);
  const problem = missingConfig(env);
  if (problem) return json(env, 503, { ok: false, error: problem });
  const op = query.op ?? "exchange";

  if (op === "create") return method === "POST" ? create(env, headers, body) : json(env, 405, { ok: false });

  if (op === "join") {
    if (method !== "POST") return json(env, 405, { ok: false });
    if (await limitedByIp(env, "syncjoin", headers, 15)) return json(env, 429, { ok: false, error: "Too many attempts, wait a minute" });
    const lookup = String((body as { lookup?: string } | null)?.lookup ?? "");
    if (!LOOKUP_RE.test(lookup)) return json(env, 400, { ok: false, error: "Invalid code" });
    const wrapped = (await redis(env, ["GETDEL", `syncpair:${lookup}`])) as string | null; // single use
    return wrapped ? json(env, 200, { ok: true, wrapped }) : json(env, 404, { ok: false, error: "That code is wrong, expired or already used" });
  }

  const vault = await authenticate(env, headers);
  if (!vault) return json(env, 401, { ok: false, error: "This device is not (or no longer) allowed to use that vault" });
  if (await limited(env, `sync:${vault.slice(0, 8)}`, 600)) return json(env, 429, { ok: false, error: "Too many requests, wait a minute" });

  if (op === "exchange" && method === "POST") return exchange(env, vault, body);
  if (op === "info" && method === "GET") {
    const [seq, items] = (await pipeline(env, [["GET", k(vault, "seq")], ["ZCARD", k(vault, "log")]])) as [string | null, number];
    return json(env, 200, { ok: true, seq: Number(seq ?? 0), items: Number(items) });
  }
  if (op === "pair" && method === "POST") {
    const b = (body ?? {}) as { lookup?: string; wrapped?: string };
    if (!LOOKUP_RE.test(b.lookup ?? "") || typeof b.wrapped !== "string" || b.wrapped.length < 20 || b.wrapped.length > 4000) {
      return json(env, 400, { ok: false, error: "Invalid pairing request" });
    }
    await redis(env, ["SET", `syncpair:${b.lookup}`, b.wrapped, "EX", PAIR_TTL_S]);
    return json(env, 200, { ok: true, expiresIn: PAIR_TTL_S });
  }
  if (op === "delete" && method === "DELETE") return wipe(env, vault);
  return json(env, 405, { ok: false });
}

