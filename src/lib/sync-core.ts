/**
 * Pure logic of multi-device sync: what changed locally, and how remote changes are merged in.
 * No I/O, no browser APIs — unit-testable and run identically on every device.
 *
 * Model: every task/tag/habit/completion is an "item" with key `kind:id`. For each item we remember
 * `known[key] = {sig, u, dev}` — the signature of the version last agreed with the server and its
 * stamp. A local item whose signature differs from `known` is "dirty" and gets a fresh stamp when
 * pushed. The highest (u, dev) wins; `u` is a hybrid logical clock so a device with a slow clock
 * still wins after it has seen a newer remote edit. Deletions are tombstones.
 */

import { compareStamps, type Stamp } from "../../telegram-bot/lib/sync-shared";

export type Kind = "task" | "tag" | "habit" | "completion";
export const KINDS: Kind[] = ["task", "tag", "habit", "completion"];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Item = Record<string, any>;

export interface LocalData {
  tasks: Item[];
  tags: Item[];
  habits: Item[];
  completions: Item[];
}

export interface Known extends Stamp {
  sig: string;
  del?: boolean;
}

export interface SyncMeta {
  dev: string;
  /** Highest stamp issued or seen — the hybrid logical clock. */
  clock: number;
  /** Highest server sequence number processed. */
  cursor: number;
  known: Record<string, Known>;
}

export interface Pending extends Stamp {
  key: string;
  sig: string;
  del: boolean;
  /** Plain payload to encrypt: the item, or {__del:true}. */
  payload: Item;
}

export interface Remote extends Stamp {
  key: string;
  /** Decrypted payload. */
  payload: Item;
}

const FIELD: Record<Kind, keyof LocalData> = { task: "tasks", tag: "tags", habit: "habits", completion: "completions" };
export const kindOfKey = (key: string): Kind => key.slice(0, key.indexOf(":")) as Kind;
export const idOfKey = (key: string): string => key.slice(key.indexOf(":") + 1);

/** Stable JSON: sorted keys, device-specific fields (user_id) dropped. */
function canonical(v: unknown, top = false): string {
  if (Array.isArray(v)) return `[${v.map((x) => canonical(x)).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Item;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined && !(top && k === "user_id"))
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

/** 53-bit string hash (cyrb53) — compact, collisions are astronomically unlikely for this use. */
export function hash(s: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export const signature = (item: Item): string => hash(canonical(item, true));

export function itemMap(data: LocalData): Map<string, Item> {
  const out = new Map<string, Item>();
  for (const kind of KINDS) {
    for (const item of data[FIELD[kind]]) if (item && typeof item.id === "string") out.set(`${kind}:${item.id}`, item);
  }
  return out;
}

export function observe(meta: SyncMeta, u: number): void {
  if (u > meta.clock) meta.clock = u;
}

function tick(meta: SyncMeta, now: number): number {
  meta.clock = Math.max(now, meta.clock + 1);
  return meta.clock;
}

/** Items changed or deleted since they were last agreed with the server. Stamps are assigned here. */
export function diffLocal(data: LocalData, meta: SyncMeta, now: number): Pending[] {
  const out: Pending[] = [];
  const current = itemMap(data);
  for (const [key, item] of current) {
    const sig = signature(item);
    const k = meta.known[key];
    if (!k || k.del || k.sig !== sig) out.push({ key, sig, del: false, payload: item, u: tick(meta, now), dev: meta.dev });
  }
  for (const [key, k] of Object.entries(meta.known)) {
    if (!k.del && !current.has(key)) out.push({ key, sig: "", del: true, payload: { __del: true }, u: tick(meta, now), dev: meta.dev });
  }
  return out;
}

/** Record what the server did with a push. Accepted → agreed. Rejected → the server has something newer, which arrives by pull. */
export function commitPush(meta: SyncMeta, pending: Pending[], accepted: string[], rejected: string[]): void {
  const ok = new Set(accepted);
  const no = new Set(rejected);
  for (const p of pending) {
    if (ok.has(p.key) || no.has(p.key)) {
      // For a rejected push, mark the item clean at our attempted stamp: the newer server version then applies on pull.
      meta.known[p.key] = { sig: p.sig, u: p.u, dev: p.dev, ...(p.del ? { del: true } : {}) };
    }
  }
}

export interface ApplyResult {
  data: LocalData;
  changed: boolean;
  applied: number;
}

/**
 * Merges decrypted remote records into local data. Remote wins only if it is newer than the version
 * last agreed AND the local item has no unpushed edit (those win — they will be stamped above every
 * stamp seen here because the clock is advanced first).
 */
export function applyRemote(
  data: LocalData,
  meta: SyncMeta,
  remote: Remote[],
  opts: { userId: string; validate: (kind: Kind, item: Item) => boolean },
): ApplyResult {
  const next: LocalData = { tasks: [...data.tasks], tags: [...data.tags], habits: [...data.habits], completions: [...data.completions] };
  let applied = 0;
  for (const r of [...remote].sort((a, b) => compareStamps(a, b))) {
    observe(meta, r.u);
    const kind = kindOfKey(r.key);
    const id = idOfKey(r.key);
    const list = next[FIELD[kind]];
    const idx = list.findIndex((x) => x?.id === id);
    const local = idx >= 0 ? list[idx] : null;
    const k = meta.known[r.key];
    if (k && compareStamps(r, k) <= 0) continue; // we already have this or newer
    const dirty = k ? (local ? signature(local) !== k.sig : !k.del) : !!local;
    if (dirty) continue;

    if (r.payload.__del) {
      if (idx >= 0) list.splice(idx, 1);
      meta.known[r.key] = { sig: "", u: r.u, dev: r.dev, del: true };
      applied++;
      continue;
    }
    const item: Item = { ...r.payload, id };
    if (!opts.validate(kind, item)) continue; // never let a malformed record corrupt local data
    if (kind === "task" || kind === "tag" || kind === "habit" || kind === "completion") item.user_id = opts.userId;
    if (idx >= 0) list[idx] = item;
    else list.push(item);
    meta.known[r.key] = { sig: signature(item), u: r.u, dev: r.dev };
    applied++;
  }
  next.tasks.sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
  return { data: next, changed: applied > 0, applied };
}

/** True when nothing local is waiting to be pushed. */
export function isClean(data: LocalData, meta: SyncMeta): boolean {
  const current = itemMap(data);
  for (const [key, item] of current) {
    const k = meta.known[key];
    if (!k || k.del || k.sig !== signature(item)) return false;
  }
  for (const [key, k] of Object.entries(meta.known)) if (!k.del && !current.has(key)) return false;
  return true;
}
