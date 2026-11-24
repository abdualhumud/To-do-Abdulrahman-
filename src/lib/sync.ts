"use client";

/**
 * Multi-device sync runtime: create a vault, add a device with a one-time code, exchange changes.
 * The server only ever sees ciphertext (see sync-crypto.ts / telegram-bot/lib/sync.ts).
 */

import { z } from "zod";
import {
  CompletionSchema,
  HabitSchema,
  TagSchema,
  TaskSchema,
  flushLocalStore,
  hydrateLocalStore,
  localCompletions,
  localHabits,
  localSync,
  localTags,
  localTasks,
  localTelegram,
  localUser,
  subscribeStore,
  type LocalSync,
} from "@/lib/local-store";
import { refreshStores } from "@/lib/refresh";
import { getSyncStatus, setSyncStatus } from "@/lib/sync-status";
import { isClean, type Item, type Kind, type LocalData, type SyncMeta } from "@/lib/sync-core";
import { DecryptError, formatCode, importVaultKey, isCompleteCode, newDeviceId, newPairCode, newVaultSecrets, normalizeCode, pairLookup, unwrapFromPairing, wrapForPairing } from "@/lib/sync-crypto";
import { syncOnce, type ExchangeRequest, type ExchangeResponse, type Host, type Transport } from "@/lib/sync-engine";

const REQUEST_TIMEOUT_MS = 20_000;
const POLL_MS = 20_000;
const PUSH_DEBOUNCE_MS = 1_000;

export class SyncError extends Error {
  constructor(message: string, readonly status = 0) {
    super(message);
  }
}

export function normalizeServer(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new SyncError("Enter the address of your bot server, e.g. https://taskflow-bot.your-name.workers.dev");
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    throw new SyncError("That doesn't look like a web address");
  }
  if (url.protocol !== "https:") throw new SyncError("The server address must start with https://");
  return url.origin;
}

async function call<T>(base: string, op: string, method: string, body?: unknown, auth?: { vaultId: string; token: string }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${base}/api/sync?op=${op}`, {
      method,
      headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(auth ? { Authorization: `Bearer ${auth.vaultId}.${auth.token}` } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new SyncError(`Couldn't reach ${new URL(base).host}. Check the address and your connection.`);
  }
  const data = (await res.json().catch(() => null)) as (T & { ok?: boolean; error?: string }) | null;
  if (!data || typeof data !== "object") throw new SyncError("That address doesn't look like a TaskFlow server (no JSON reply).", res.status);
  if (data.ok === false || !res.ok) throw new SyncError(data.error ?? `Server error ${res.status}`, res.status);
  return data;
}

// ─── Local data bridge ────────────────────────────────────────────────────────

const VALIDATORS: Record<Kind, z.ZodType> = { task: TaskSchema, tag: TagSchema, habit: HabitSchema, completion: CompletionSchema };

function readData(): LocalData {
  return { tasks: localTasks.get(), tags: localTags.get(), habits: localHabits.get(), completions: localCompletions.get() };
}

function writeData(d: LocalData): void {
  localTasks.set(d.tasks);
  localTags.set(d.tags);
  localHabits.set(d.habits);
  localCompletions.set(d.completions);
}

function metaOf(s: LocalSync): SyncMeta {
  return { dev: s.dev, clock: s.clock, cursor: s.cursor, known: s.known };
}

/** True when this device has an unpushed local change (used to hold back reminder replace-all). */
export function hasUnsyncedChanges(): boolean {
  const s = localSync.get();
  return s ? !isClean(readData(), metaOf(s)) : false;
}

export const isSyncEnabled = (): boolean => localSync.get() !== null;

// ─── Setup ────────────────────────────────────────────────────────────────────

function store(base: string, secrets: { vaultId: string; token: string; key: string }): LocalSync {
  const s: LocalSync = { serverUrl: base, ...secrets, dev: newDeviceId(), clock: 0, cursor: 0, known: {} };
  localSync.set(s);
  return s;
}

/** First device: creates the encrypted vault on the server and uploads everything. */
export async function enableSync(rawServer: string): Promise<void> {
  await hydrateLocalStore();
  if (localSync.get()) throw new SyncError("Sync is already on for this device.");
  const base = normalizeServer(rawServer);
  const secrets = newVaultSecrets();
  await call(base, "create", "POST", { vaultId: secrets.vaultId, token: secrets.token });
  store(base, secrets);
  await flushLocalStore(); // the credentials must be on disk before anything else can go wrong
  await syncNow();
}

/** Another device: unlocks the vault secrets with the one-time code, then downloads everything. */
export async function joinSync(rawServer: string, rawCode: string): Promise<void> {
  await hydrateLocalStore();
  if (localSync.get()) throw new SyncError("Sync is already on for this device.");
  const base = normalizeServer(rawServer);
  const code = normalizeCode(rawCode);
  if (!isCompleteCode(code)) throw new SyncError("The code has 12 letters and digits, like ABCD-EFGH-JKLM.");
  const { wrapped } = await call<{ wrapped: string }>(base, "join", "POST", { lookup: await pairLookup(code) });
  let payload;
  try {
    payload = await unwrapFromPairing(code, wrapped);
  } catch (e) {
    throw new SyncError(e instanceof Error ? e.message : "Wrong code");
  }
  store(base, payload);
  await flushLocalStore();
  // Share the same Telegram bot inbox so the bot adds tasks no matter which device is open.
  if (payload.inboxKey && payload.bot && !localTelegram.get()) {
    localTelegram.set({ mode: "server", token: "", serverUrl: base, inboxKey: payload.inboxKey, botUsername: payload.bot, chatId: 1, pairCode: null, pairExpires: null, offset: 0 });
  }
  await syncNow();
}

/** Creates a single-use code (valid 10 minutes) that lets another device join this vault. */
export async function createPairCode(): Promise<{ code: string; display: string; serverUrl: string }> {
  const s = localSync.get();
  if (!s) throw new SyncError("Turn sync on first.");
  const tg = localTelegram.get();
  const code = newPairCode();
  const wrapped = await wrapForPairing(code, {
    vaultId: s.vaultId,
    token: s.token,
    key: s.key,
    serverUrl: s.serverUrl,
    ...(tg?.mode === "server" && tg.chatId !== null && tg.serverUrl === s.serverUrl ? { inboxKey: tg.inboxKey, bot: tg.botUsername } : {}),
  });
  await call(s.serverUrl, "pair", "POST", { lookup: await pairLookup(code), wrapped }, s);
  return { code, display: formatCode(code), serverUrl: s.serverUrl };
}

/** Stops syncing on this device. Optionally deletes the encrypted copy from the server for every device. */
export async function leaveSync(deleteServerCopy: boolean): Promise<void> {
  const s = localSync.get();
  if (!s) return;
  if (deleteServerCopy) await call(s.serverUrl, "delete", "DELETE", undefined, s);
  localSync.clear();
  setSyncStatus({ syncing: false, lastSync: null, error: null, current: false });
}

// ─── Exchange ─────────────────────────────────────────────────────────────────

let running: Promise<void> | null = null;
let again = false;

function transportFor(s: LocalSync): Transport {
  return { exchange: (req: ExchangeRequest) => call<ExchangeResponse>(s.serverUrl, "exchange", "POST", req, s) };
}

async function round(): Promise<void> {
  const s = localSync.get();
  if (!s) return;
  const user = localUser.get();
  if (!user) return;
  const meta = metaOf(s);
  const host: Host = {
    read: readData,
    write: (d) => {
      writeData(d);
      refreshStores();
    },
    meta,
    save: () => {
      const latest = localSync.get();
      if (latest) localSync.set({ ...latest, clock: meta.clock, cursor: meta.cursor, known: meta.known });
    },
    userId: () => user.id,
    now: Date.now,
    validate: (kind: Kind, item: Item) => VALIDATORS[kind].safeParse(item).success,
  };
  setSyncStatus({ syncing: true });
  try {
    await syncOnce(host, transportFor(s), await importVaultKey(s.key));
    setSyncStatus({ syncing: false, lastSync: Date.now(), error: null, current: isClean(readData(), meta) });
  } catch (e) {
    const message =
      e instanceof DecryptError
        ? e.message
        : e instanceof SyncError && e.status === 401
          ? "This device was removed from sync (or the vault was deleted). Turn sync off and join again."
          : e instanceof Error
            ? e.message
            : "Sync failed";
    setSyncStatus({ syncing: false, error: message, current: false });
    throw e;
  }
}

/** Runs a sync round now. Concurrent calls share one run; a call during a run schedules one more. */
export async function syncNow(): Promise<void> {
  await hydrateLocalStore();
  if (!localSync.get()) return;
  if (running) {
    again = true;
    return running;
  }
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  const work = async () => {
    do {
      again = false;
      await round();
    } while (again);
  };
  const run: Promise<void> = (async () => {
    if (locks) await locks.request("tf-sync", work);
    else await work();
  })();
  running = run.finally(() => {
    running = null;
  });
  return running;
}

/** Background loop: changes are pushed ~1 s after an edit; remote changes are pulled every 20 s while visible. */
export function startSyncRuntime(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = () => {
    if (document.visibilityState !== "visible" || !localSync.get()) return;
    syncNow().catch(() => undefined);
  };
  const soon = () => {
    if (!localSync.get() || getSyncStatus().syncing || !hasUnsyncedChanges()) return;
    clearTimeout(timer);
    timer = setTimeout(run, PUSH_DEBOUNCE_MS);
  };
  const interval = setInterval(run, POLL_MS);
  const unsub = subscribeStore(soon);
  const resume = ["focus", "pageshow", "online"] as const;
  resume.forEach((n) => window.addEventListener(n, run));
  document.addEventListener("visibilitychange", run);
  run();
  return () => {
    clearTimeout(timer);
    clearInterval(interval);
    unsub();
    resume.forEach((n) => window.removeEventListener(n, run));
    document.removeEventListener("visibilitychange", run);
  };
}
