/**
 * local-store.ts
 * localStorage persistence for the no-database mode. All data stays in this browser.
 *
 * Design notes (learned the hard way — see CLAUDE.md):
 * - Values are AES-GCM encrypted with a NON-EXTRACTABLE key persisted in IndexedDB.
 *   The key must outlive the tab, otherwise data is unreadable after a restart.
 *   This is obfuscation against casual inspection of localStorage, not a defence
 *   against XSS or someone using the unlocked browser.
 * - Everything is decrypted ONCE into an in-memory cache by hydrateLocalStore().
 *   After that all reads are synchronous and writes are write-through + serialized.
 * - Data is validated with Zod at trust boundaries (reading disk, importing backups),
 *   never silently on write — dropping a task because of a schema mismatch is data loss.
 * - Other tabs are kept coherent through the `storage` event.
 */

import { z } from "zod";
import { REPEATS } from "../../telegram-bot/lib/recurrence";

export interface LocalUser {
  id: string;
  name: string;
  email: string;
}

export interface LocalTelegram {
  /** "browser": this browser polls Telegram with the bot token. "server": an always-on Vercel server holds the bot. */
  mode: "browser" | "server";
  token: string; // browser mode
  serverUrl: string; // server mode
  inboxKey: string; // server mode: secret that authorises reading this app's inbox
  botUsername: string;
  chatId: number | null;
  pairCode: string | null;
  pairExpires: number | null;
  offset: number;
}

// ─── Schemas ──────────────────────────────────────────────────────────────────

const LocalUserSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200),
  email: z.string().max(320),
});

export const TaskSchema = z
  .object({
    id: z.string(),
    title: z.string().min(1).max(1000),
    description: z.string().max(5000).nullable().optional(),
    status: z.enum(["pending", "in_progress", "completed", "cancelled"]).optional(),
    priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
    category: z.string().max(100).optional(),
    due_date: z.string().nullable().optional(),
    completed_at: z.string().nullable().optional(),
    created_at: z.string().optional(),
    reminder_at: z.string().nullable().optional(),
    repeat: z.enum(REPEATS as [string, ...string[]]).optional(),
    reminder_channels: z.array(z.enum(["telegram", "email", "push", "inapp"])).optional(),
    tags: z.array(z.object({ id: z.string(), name: z.string() }).passthrough()).optional(),
  })
  .passthrough();

export const TagSchema = z
  .object({
    id: z.string(),
    name: z.string().min(1).max(100),
    color: z.string().max(20).optional(),
  })
  .passthrough();

export const HabitSchema = z
  .object({
    id: z.string(),
    title: z.string().min(1).max(500),
    frequency: z.enum(["daily", "weekly", "monthly"]).optional(),
    created_at: z.string().optional(),
  })
  .passthrough();

export const CompletionSchema = z
  .object({
    id: z.string(),
    habit_id: z.string(),
    completed_at: z.string(),
  })
  .passthrough();

export interface LocalSync {
  serverUrl: string;
  vaultId: string;
  token: string;
  /** AES key for the vault — stays on this device (and is handed to new devices only inside a pairing code). */
  key: string;
  dev: string;
  clock: number;
  cursor: number;
  known: Record<string, { sig: string; u: number; dev: string; del?: boolean }>;
}

export interface LocalPrefs {
  /** Opt-in: keep a copy of dated open tasks on the bot server (needed for reminders when the app is closed and for the calendar feed). */
  syncToServer: boolean;
  /** Channels pre-selected for new reminders. */
  defaultChannels: ("telegram" | "email" | "push" | "inapp")[];
  /** This device has been registered for phone notifications. */
  pushDevice: boolean;
  /** Last occurrence (ms) already shown in-app, per task id. */
  firedLocal: Record<string, number>;
}

export const DEFAULT_PREFS: LocalPrefs = { syncToServer: false, defaultChannels: ["telegram", "inapp"], pushDevice: false, firedLocal: {} };

const PrefsSchema = z.object({
  syncToServer: z.boolean().default(false),
  defaultChannels: z.array(z.enum(["telegram", "email", "push", "inapp"])).default(["telegram", "inapp"]),
  pushDevice: z.boolean().default(false),
  firedLocal: z.record(z.string(), z.number()).default({}),
});

const SyncSchema = z.object({
  serverUrl: z.string().max(300),
  vaultId: z.string().max(40),
  token: z.string().max(80),
  key: z.string().max(80),
  dev: z.string().max(40),
  clock: z.number(),
  cursor: z.number(),
  known: z.record(z.string(), z.object({ sig: z.string(), u: z.number(), dev: z.string(), del: z.boolean().optional() })),
});

const TelegramSchema = z.object({
  mode: z.enum(["browser", "server"]).default("browser"),
  token: z.string().max(200).default(""),
  serverUrl: z.string().max(300).default(""),
  inboxKey: z.string().max(64).default(""),
  botUsername: z.string().max(100),
  chatId: z.number().nullable(),
  pairCode: z.string().max(20).nullable(),
  pairExpires: z.number().nullable(),
  offset: z.number().int().min(0).default(0),
});

// ─── Keys ─────────────────────────────────────────────────────────────────────

const K = {
  user: "tf_user",
  tasks: "tf_tasks",
  tags: "tf_tags",
  habits: "tf_habits",
  completions: "tf_habit_completions",
  telegram: "tf_telegram",
  prefs: "tf_prefs",
  sync: "tf_sync",
  legacySessionKey: "tf_enc_key", // v1 stored the AES key in sessionStorage (lost on tab close)
} as const;

const DATA_KEYS: string[] = [K.user, K.tasks, K.tags, K.habits, K.completions, K.telegram, K.prefs, K.sync];
const ARRAY_SCHEMAS: Record<string, z.ZodType> = {
  [K.tasks]: TaskSchema,
  [K.tags]: TagSchema,
  [K.habits]: HabitSchema,
  [K.completions]: CompletionSchema,
};

const ENC_V1 = "enc:v1:";
const ENC_V2 = "enc:v2:";

// ─── Change notification (for useSyncExternalStore) ───────────────────────────

let _version = 0;
const _listeners = new Set<() => void>();
const _externalListeners = new Set<() => void>();

function notify(): void {
  _version++;
  _listeners.forEach((cb) => cb());
}

export function subscribeStore(cb: () => void): () => void {
  _listeners.add(cb);
  return () => _listeners.delete(cb);
}

/** Increments on every write and once when hydration completes (so > 0 means ready). */
export function getStoreVersion(): number {
  return _version;
}

/** Fires when ANOTHER tab changed stored data (after this tab refreshed its cache). */
export function onExternalChange(cb: () => void): () => void {
  _externalListeners.add(cb);
  return () => _externalListeners.delete(cb);
}

// ─── Encryption key (persistent, non-extractable, in IndexedDB) ───────────────

let _encKey: CryptoKey | null = null;
let _legacyKey: CryptoKey | null = null;
let _keyPromise: Promise<void> | null = null;

const KEY_DB = "tf_keystore";
const KEY_STORE = "keys";
const KEY_ID = "aes-gcm-main";

function openKeyDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(KEY_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(KEY_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("IndexedDB blocked"));
  });
}

/** Atomically returns the stored key, or stores `candidate` if none exists (safe across tabs). */
function getOrStoreKey(db: IDBDatabase, candidate: CryptoKey): Promise<CryptoKey> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(KEY_STORE, "readwrite");
    const store = tx.objectStore(KEY_STORE);
    let result = candidate;
    const getReq = store.get(KEY_ID);
    getReq.onsuccess = () => {
      if (getReq.result) result = getReq.result as CryptoKey;
      else store.put(candidate, KEY_ID);
    };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function initEncryptionKey(): Promise<void> {
  if (_keyPromise) return _keyPromise;
  _keyPromise = (async () => {
    if (typeof window === "undefined") return;
    try {
      const candidate = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
        "encrypt",
        "decrypt",
      ]);
      const db = await openKeyDb();
      try {
        _encKey = await getOrStoreKey(db, candidate);
      } finally {
        db.close();
      }
    } catch {
      _encKey = null; // IndexedDB / WebCrypto unavailable → data is stored as plain JSON
    }
    try {
      const stored = sessionStorage.getItem(K.legacySessionKey);
      if (stored) {
        _legacyKey = await crypto.subtle.importKey("jwk", JSON.parse(stored), { name: "AES-GCM" }, false, [
          "decrypt",
        ]);
      }
    } catch {
      _legacyKey = null;
    }
  })();
  return _keyPromise;
}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function fromBase64(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function encryptString(plain: string): Promise<string> {
  if (!_encKey) return plain;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, _encKey, new TextEncoder().encode(plain)));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return ENC_V2 + toBase64(out);
}

/** Returns the plaintext JSON string, or null when it cannot be decrypted. */
async function decryptString(raw: string): Promise<string | null> {
  const isV2 = raw.startsWith(ENC_V2);
  const isV1 = raw.startsWith(ENC_V1);
  if (!isV1 && !isV2) return raw; // plain JSON (legacy or no-encryption fallback)
  const key = isV2 ? _encKey : _legacyKey;
  if (!key) return null;
  try {
    const bytes = fromBase64(raw.slice(isV2 ? ENC_V2.length : ENC_V1.length));
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) }, key, bytes.slice(12));
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

// ─── Cache, hydration, serialized writes ──────────────────────────────────────

const _memCache = new Map<string, unknown>();
let _hydrated = false;
let _hydratePromise: Promise<void> | null = null;
let _writeChain: Promise<void> = Promise.resolve();

function sanitize(key: string, parsed: unknown): unknown | undefined {
  if (key === K.user) {
    const r = LocalUserSchema.safeParse(parsed);
    return r.success ? r.data : undefined;
  }
  if (key === K.telegram) {
    const r = TelegramSchema.safeParse(parsed);
    return r.success ? r.data : undefined;
  }
  if (key === K.sync) {
    const r = SyncSchema.safeParse(parsed);
    return r.success ? r.data : undefined;
  }
  if (key === K.prefs) {
    const r = PrefsSchema.safeParse(parsed);
    return r.success ? r.data : undefined;
  }
  const schema = ARRAY_SCHEMAS[key];
  if (!schema || !Array.isArray(parsed)) return undefined;
  const valid = parsed.filter((item) => schema.safeParse(item).success);
  if (valid.length !== parsed.length) {
    console.warn(`[local-store] ${parsed.length - valid.length} invalid item(s) skipped in ${key}`);
  }
  return valid;
}

function safeGetItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

async function hydrateKey(key: string): Promise<void> {
  if (_memCache.has(key)) return;
  const raw = safeGetItem(key);
  if (!raw) return;
  const json = await decryptString(raw);
  if (json === null) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return;
  }
  const clean = sanitize(key, parsed);
  if (clean === undefined || _memCache.has(key)) return; // a newer in-memory write wins
  _memCache.set(key, clean);
  if (!raw.startsWith(ENC_V2) && _encKey) queueFlush(key); // upgrade plain / v1 data to v2
}

export function hydrateLocalStore(): Promise<void> {
  if (_hydratePromise) return _hydratePromise;
  _hydratePromise = (async () => {
    if (typeof window === "undefined") return;
    try {
      await initEncryptionKey();
      await Promise.all(DATA_KEYS.map(hydrateKey));
      try {
        sessionStorage.removeItem(K.legacySessionKey);
      } catch {
        /* ignore */
      }
    } finally {
      _hydrated = true;
      notify();
    }
  })();
  return _hydratePromise;
}

/** Resolves when every write made so far has reached localStorage (use before something irreversible). */
export function flushLocalStore(): Promise<void> {
  return _writeChain;
}

export function isHydrated(): boolean {
  return _hydrated;
}

function queueFlush(key: string): void {
  _writeChain = _writeChain
    .then(async () => {
      if (typeof window === "undefined" || !_memCache.has(key)) return;
      await initEncryptionKey();
      const value = _memCache.get(key); // always persist the latest value
      localStorage.setItem(key, await encryptString(JSON.stringify(value)));
    })
    .catch(() => {
      try {
        if (_memCache.has(key)) localStorage.setItem(key, JSON.stringify(_memCache.get(key)));
      } catch {
        /* storage full or blocked */
      }
    });
}

function writeValue(key: string, value: unknown): void {
  _memCache.set(key, value);
  queueFlush(key);
  notify();
}

function removeValue(key: string): void {
  _memCache.delete(key);
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
  notify();
}

function readValue<T>(key: string, fallback: T): T {
  return _memCache.has(key) ? (_memCache.get(key) as T) : fallback;
}

if (typeof window !== "undefined") {
  void hydrateLocalStore();
  window.addEventListener("storage", (e) => {
    if (e.storageArea !== localStorage) return;
    if (e.key !== null && !DATA_KEYS.includes(e.key)) return;
    const keys = e.key === null ? DATA_KEYS : [e.key];
    keys.forEach((k) => _memCache.delete(k));
    Promise.all(keys.map(hydrateKey)).then(() => {
      notify();
      _externalListeners.forEach((cb) => cb());
    });
  });
}

// ─── Domain helpers ───────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyArray = any[];

export const localUser = {
  get: (): LocalUser | null => readValue<LocalUser | null>(K.user, null),
  set: (u: LocalUser) => writeValue(K.user, LocalUserSchema.parse(u)),
  clear: () => removeValue(K.user),
};

export const localTelegram = {
  get: (): LocalTelegram | null => readValue<LocalTelegram | null>(K.telegram, null),
  set: (t: LocalTelegram) => writeValue(K.telegram, TelegramSchema.parse(t)),
  clear: () => removeValue(K.telegram),
};

export const localSync = {
  get: (): LocalSync | null => readValue<LocalSync | null>(K.sync, null),
  set: (v: LocalSync) => writeValue(K.sync, SyncSchema.parse(v)),
  clear: () => removeValue(K.sync),
};

export const localPrefs = {
  get: (): LocalPrefs => readValue<LocalPrefs>(K.prefs, DEFAULT_PREFS),
  patch: (changes: Partial<LocalPrefs>) => writeValue(K.prefs, PrefsSchema.parse({ ...localPrefs.get(), ...changes })),
};

function arrayStore(key: string) {
  return {
    get: (): AnyArray => {
      const v = readValue<unknown>(key, []);
      return Array.isArray(v) ? v : [];
    },
    getAsync: async (): Promise<AnyArray> => {
      await hydrateLocalStore();
      const v = readValue<unknown>(key, []);
      return Array.isArray(v) ? v : [];
    },
    set: (v: AnyArray) => writeValue(key, v),
  };
}

export const localTasks = arrayStore(K.tasks);
export const localTags = arrayStore(K.tags);
export const localHabits = arrayStore(K.habits);
export const localCompletions = arrayStore(K.completions);
