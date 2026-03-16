/**
 * local-store.ts
 * Thin localStorage wrappers that replace Supabase for the "no-database" mode.
 * All data is stored in the user's browser only.
 *
 * Security measures applied:
 * 1. All values validated with Zod schemas before use (prevents injected/corrupted data)
 * 2. Writes are AES-GCM encrypted using a per-session key in sessionStorage
 *    (protects data at rest when the browser is closed; key is cleared on tab close)
 * 3. Reads fall back to plain JSON for legacy unencrypted data, then re-encrypt on save
 */

import { z } from "zod";

export interface LocalUser {
  id: string;
  name: string;
  email: string;
}

// ─── Zod Schemas ──────────────────────────────────────────────────────────────

const LocalUserSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200),
  email: z.string().max(320),
});

const TaskSchema = z
  .object({
    id: z.string(),
    title: z.string().min(1).max(1000),
    description: z.string().max(5000).optional(),
    status: z.enum(["pending", "in_progress", "completed", "cancelled"]).optional(),
    priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
    category: z.string().max(100).optional(),
    due_date: z.string().nullable().optional(),
    completed_at: z.string().nullable().optional(),
    created_at: z.string().optional(),
    tags: z.array(z.string()).optional(),
  })
  .passthrough();

const TagSchema = z
  .object({
    id: z.string(),
    name: z.string().min(1).max(100),
    color: z.string().max(20).optional(),
  })
  .passthrough();

const HabitSchema = z
  .object({
    id: z.string(),
    title: z.string().min(1).max(500),
    frequency: z.enum(["daily", "weekly", "monthly"]).optional(),
    created_at: z.string().optional(),
  })
  .passthrough();

const CompletionSchema = z
  .object({
    id: z.string(),
    habit_id: z.string(),
    completed_at: z.string(),
  })
  .passthrough();

// ─── Storage keys ─────────────────────────────────────────────────────────────
const K = {
  user: "tf_user",
  tasks: "tf_tasks",
  tags: "tf_tags",
  habits: "tf_habits",
  completions: "tf_habit_completions",
  encKey: "tf_enc_key", // lives in sessionStorage (cleared on tab/browser close)
} as const;

const ENC_PREFIX = "enc:v1:";

// ─── AES-GCM Key Management ───────────────────────────────────────────────────

let _encKey: CryptoKey | null = null;
let _keyInitPromise: Promise<void> | null = null;

function initEncryptionKey(): Promise<void> {
  if (_keyInitPromise) return _keyInitPromise;
  _keyInitPromise = (async () => {
    if (typeof window === "undefined") return;
    try {
      const stored = sessionStorage.getItem(K.encKey);
      if (stored) {
        try {
          const jwk = JSON.parse(stored);
          _encKey = await crypto.subtle.importKey(
            "jwk",
            jwk,
            { name: "AES-GCM" },
            false,
            ["encrypt", "decrypt"],
          );
          return;
        } catch {
          // Corrupted key — generate fresh one
        }
      }
      const key = await crypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"],
      );
      const exported = await crypto.subtle.exportKey("jwk", key);
      sessionStorage.setItem(K.encKey, JSON.stringify(exported));
      _encKey = key;
    } catch {
      // crypto.subtle unavailable (HTTP / old browser) — fall back to plain JSON
    }
  })();
  return _keyInitPromise;
}

// Kick off key init as soon as the module is loaded client-side
if (typeof window !== "undefined") {
  initEncryptionKey();
}

// ─── Write-through in-memory cache ────────────────────────────────────────────
// Populated synchronously on every write so that readSync() always returns the
// latest value even when the localStorage copy is encrypted (async-only).
const _memCache = new Map<string, unknown>();

async function encryptAndWrite(storageKey: string, value: unknown): Promise<void> {
  if (typeof window === "undefined") return;
  await initEncryptionKey();
  const jsonStr = JSON.stringify(value);
  if (_encKey) {
    try {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encoded = new TextEncoder().encode(jsonStr);
      const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, _encKey, encoded);
      const combined = new Uint8Array(12 + ciphertext.byteLength);
      combined.set(iv);
      combined.set(new Uint8Array(ciphertext), 12);
      localStorage.setItem(storageKey, ENC_PREFIX + btoa(String.fromCharCode(...combined)));
      return;
    } catch {
      // Fall through to plain write
    }
  }
  localStorage.setItem(storageKey, jsonStr);
}

async function decryptOrRead(raw: string): Promise<string> {
  if (!raw.startsWith(ENC_PREFIX)) return raw; // Legacy plain JSON
  await initEncryptionKey();
  if (!_encKey) return "null";
  try {
    const combined = Uint8Array.from(atob(raw.slice(ENC_PREFIX.length)), (c) => c.charCodeAt(0));
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);
    const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, _encKey, ciphertext);
    return new TextDecoder().decode(decrypted);
  } catch {
    return "null";
  }
}

// ─── Generic helpers ──────────────────────────────────────────────────────────

/** Synchronous read — checks in-memory cache first, then localStorage (plain JSON only). */
function readSync<T>(storageKey: string, fallback: T): T {
  // In-memory cache is always authoritative (populated by writeAsync on every write)
  if (_memCache.has(storageKey)) {
    return _memCache.get(storageKey) as T;
  }
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return fallback;
    if (raw.startsWith(ENC_PREFIX)) {
      // Encrypted data not yet in cache (page just loaded). The caller must use
      // getAsync() / an async fetch function to decrypt and populate the cache.
      return fallback;
    }
    // Legacy plain JSON — parse and warm the cache
    const value = JSON.parse(raw) as T;
    _memCache.set(storageKey, value);
    return value;
  } catch {
    return fallback;
  }
}

/** Async read — decrypts if necessary and validates. */
async function readAsync<T>(storageKey: string, fallback: T): Promise<T> {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return fallback;
    const jsonStr = await decryptOrRead(raw);
    return JSON.parse(jsonStr) as T;
  } catch {
    return fallback;
  }
}

/** Fire-and-forget encrypted write. Immediately updates in-memory cache so
 *  readSync() callers see the new value without waiting for async encryption. */
function writeAsync(storageKey: string, value: unknown): void {
  // Sync cache update — makes readSync() work immediately after any write
  _memCache.set(storageKey, value);
  encryptAndWrite(storageKey, value).catch(() => {
    // Last-resort sync write if async encryption fails
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem(storageKey, JSON.stringify(value));
      } catch {
        /* storage full or blocked */
      }
    }
  });
}

// ─── Domain helpers ───────────────────────────────────────────────────────────

export const localUser = {
  /** Sync read + Zod validation. Returns null if missing or schema invalid. */
  get: (): LocalUser | null => {
    const raw = readSync<unknown>(K.user, null);
    if (!raw) return null;
    const result = LocalUserSchema.safeParse(raw);
    return result.success ? result.data : null;
  },
  /** Async read (for use in async contexts, e.g. settings page save). */
  getAsync: async (): Promise<LocalUser | null> => {
    const raw = await readAsync<unknown>(K.user, null);
    if (!raw) return null;
    const result = LocalUserSchema.safeParse(raw);
    return result.success ? result.data : null;
  },
  set: (u: LocalUser) => {
    const validated = LocalUserSchema.parse(u);
    writeAsync(K.user, validated);
  },
  clear: () => typeof window !== "undefined" && localStorage.removeItem(K.user),
};

function validateArray<T>(raw: unknown[], schema: z.ZodType<T>): unknown[] {
  return raw
    .map((item) => schema.safeParse(item))
    .filter((r): r is z.ZodSafeParseSuccess<T> => r.success)
    .map((r) => r.data);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyArray = any[];

export const localTasks = {
  get: (): AnyArray => {
    const raw = readSync<unknown[]>(K.tasks, []);
    if (!Array.isArray(raw)) return [];
    return validateArray(raw, TaskSchema);
  },
  getAsync: async (): Promise<AnyArray> => {
    const raw = await readAsync<unknown[]>(K.tasks, []);
    if (!Array.isArray(raw)) return [];
    const validated = validateArray(raw, TaskSchema);
    _memCache.set(K.tasks, validated);
    return validated;
  },
  set: (v: AnyArray) => {
    const validated = validateArray(v, TaskSchema);
    writeAsync(K.tasks, validated);
  },
};

export const localTags = {
  get: (): AnyArray => {
    const raw = readSync<unknown[]>(K.tags, []);
    if (!Array.isArray(raw)) return [];
    return validateArray(raw, TagSchema);
  },
  getAsync: async (): Promise<AnyArray> => {
    const raw = await readAsync<unknown[]>(K.tags, []);
    if (!Array.isArray(raw)) return [];
    const validated = validateArray(raw, TagSchema);
    _memCache.set(K.tags, validated);
    return validated;
  },
  set: (v: AnyArray) => {
    const validated = validateArray(v, TagSchema);
    writeAsync(K.tags, validated);
  },
};

export const localHabits = {
  get: (): AnyArray => {
    const raw = readSync<unknown[]>(K.habits, []);
    if (!Array.isArray(raw)) return [];
    return validateArray(raw, HabitSchema);
  },
  getAsync: async (): Promise<AnyArray> => {
    const raw = await readAsync<unknown[]>(K.habits, []);
    if (!Array.isArray(raw)) return [];
    const validated = validateArray(raw, HabitSchema);
    _memCache.set(K.habits, validated);
    return validated;
  },
  set: (v: AnyArray) => {
    const validated = validateArray(v, HabitSchema);
    writeAsync(K.habits, validated);
  },
};

export const localCompletions = {
  get: (): AnyArray => {
    const raw = readSync<unknown[]>(K.completions, []);
    if (!Array.isArray(raw)) return [];
    return validateArray(raw, CompletionSchema);
  },
  getAsync: async (): Promise<AnyArray> => {
    const raw = await readAsync<unknown[]>(K.completions, []);
    if (!Array.isArray(raw)) return [];
    const validated = validateArray(raw, CompletionSchema);
    _memCache.set(K.completions, validated);
    return validated;
  },
  set: (v: AnyArray) => {
    const validated = validateArray(v, CompletionSchema);
    writeAsync(K.completions, validated);
  },
};
