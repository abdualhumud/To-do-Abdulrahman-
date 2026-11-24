/**
 * Cryptography for multi-device sync. Everything stored on the server is encrypted here with a key
 * that never leaves the user's devices:
 *  - each record: AES-256-GCM, with (key|u|dev) as authenticated data so the server cannot move a
 *    ciphertext to another item or pretend it is newer;
 *  - pairing a new device: the secrets are wrapped with a key stretched (PBKDF2) from a one-time
 *    12-character code, so the server only ever sees an opaque blob and a hash of the code.
 */

import { b64urlDecode, b64urlEncode } from "../../telegram-bot/lib/webpush";
import { sha256Hex } from "../../telegram-bot/lib/sync-shared";

const enc = new TextEncoder();
const dec = new TextDecoder();

export interface VaultSecrets {
  vaultId: string; // 22 chars (public handle)
  token: string; // 43 chars (authenticates this device to the server)
  key: string; // 43 chars (AES-256 key; never sent to the server)
}

export interface PairPayload extends VaultSecrets {
  serverUrl: string;
  /** Telegram server-mode link, so the new device shares the same bot inbox. */
  inboxKey?: string;
  bot?: string;
}

function randomB64(bytes: number): string {
  return b64urlEncode(crypto.getRandomValues(new Uint8Array(new ArrayBuffer(bytes))));
}

export function newVaultSecrets(): VaultSecrets {
  return { vaultId: randomB64(16), token: randomB64(32), key: randomB64(32) };
}

export function newDeviceId(): string {
  return [...crypto.getRandomValues(new Uint8Array(6))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const keyCache = new Map<string, Promise<CryptoKey>>();

export function importVaultKey(keyB64: string): Promise<CryptoKey> {
  let k = keyCache.get(keyB64);
  if (!k) {
    k = crypto.subtle.importKey("raw", b64urlDecode(keyB64), "AES-GCM", false, ["encrypt", "decrypt"]);
    keyCache.set(keyB64, k);
  }
  return k;
}

function aad(meta: { key: string; u: number; dev: string }): Uint8Array<ArrayBuffer> {
  return new Uint8Array(enc.encode(`${meta.key}|${meta.u}|${meta.dev}`));
}

function join(iv: Uint8Array, ct: ArrayBuffer): string {
  const out = new Uint8Array(new ArrayBuffer(iv.length + ct.byteLength));
  out.set(iv);
  out.set(new Uint8Array(ct), iv.length);
  return b64urlEncode(out);
}

export class DecryptError extends Error {}

export async function encryptRecord(key: CryptoKey, meta: { key: string; u: number; dev: string }, payload: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(12)));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(meta) }, key, enc.encode(JSON.stringify(payload)));
  return join(iv, ct);
}

export async function decryptRecord<T = unknown>(key: CryptoKey, meta: { key: string; u: number; dev: string }, c: string): Promise<T> {
  try {
    const raw = b64urlDecode(c);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: raw.slice(0, 12), additionalData: aad(meta) }, key, raw.slice(12));
    return JSON.parse(dec.decode(plain)) as T;
  } catch {
    throw new DecryptError("A synced record could not be decrypted — this device has a different sync key.");
  }
}

// ─── Pairing ──────────────────────────────────────────────────────────────────

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I, O, 0, 1
const CODE_LENGTH = 12; // 60 bits; single use, expires in 10 minutes, join attempts are rate limited
const PBKDF2_ITERATIONS = 250_000;

export function newPairCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

/** Accepts what people type: any case, with or without dashes or spaces. */
export function normalizeCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function formatCode(code: string): string {
  return code.replace(/(.{4})(?=.)/g, "$1-");
}

export function isCompleteCode(code: string): boolean {
  return code.length === CODE_LENGTH && [...code].every((ch) => CODE_ALPHABET.includes(ch));
}

export const pairLookup = (code: string): Promise<string> => sha256Hex(`taskflow-sync-lookup-v1:${code}`);

async function wrapKeyFor(code: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", enc.encode(code), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: enc.encode("taskflow-sync-pair-v1"), iterations: PBKDF2_ITERATIONS },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function wrapForPairing(code: string, payload: PairPayload): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(12)));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await wrapKeyFor(code), enc.encode(JSON.stringify(payload)));
  return join(iv, ct);
}

export async function unwrapFromPairing(code: string, wrapped: string): Promise<PairPayload> {
  try {
    const raw = b64urlDecode(wrapped);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: raw.slice(0, 12) }, await wrapKeyFor(code), raw.slice(12));
    const p = JSON.parse(dec.decode(plain)) as PairPayload;
    if (!p.vaultId || !p.token || !p.key || !p.serverUrl) throw new Error("incomplete");
    return p;
  } catch {
    throw new DecryptError("That code could not unlock the sync data. Check it and try again.");
  }
}
