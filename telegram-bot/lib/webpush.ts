/**
 * Web Push (RFC 8030) with VAPID (RFC 8292) and aes128gcm payload encryption (RFC 8291), written on
 * WebCrypto only — it runs unchanged on Cloudflare Workers, Vercel and Node, so no `web-push`
 * package (which needs Node's https/crypto) is required.
 */

export interface PushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface Vapid {
  publicKey: string; // base64url, uncompressed P-256 point (65 bytes)
  privateKey: string; // base64url, 32-byte scalar "d"
}

const text = new TextEncoder();
const RECORD_SIZE = 4096;

/** Concatenates byte parts into a fresh ArrayBuffer-backed array (what WebCrypto wants). */
function bytes(...parts: (Uint8Array | number[])[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(parts.reduce((n, p) => n + p.length, 0)));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export function b64urlEncode(data: Uint8Array): string {
  let s = "";
  for (const b of data) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlDecode(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function generateVapidKeys(): Promise<Vapid> {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey("jwk", pair.privateKey)) as JsonWebKey;
  return { publicKey: b64urlEncode(bytes([4], b64urlDecode(jwk.x!), b64urlDecode(jwk.y!))), privateKey: jwk.d! };
}

async function signVapidJwt(audience: string, vapid: Vapid, subject: string, now: number): Promise<string> {
  const pub = b64urlDecode(vapid.publicKey);
  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: "EC", crv: "P-256", d: vapid.privateKey, x: b64urlEncode(pub.slice(1, 33)), y: b64urlEncode(pub.slice(33, 65)), ext: true },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const header = b64urlEncode(text.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const payload = b64urlEncode(text.encode(JSON.stringify({ aud: audience, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })));
  const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, text.encode(`${header}.${payload}`)));
  return `${header}.${payload}.${b64urlEncode(signature)}`; // WebCrypto returns the raw r||s form JWT needs
}

async function hkdf(ikm: Uint8Array<ArrayBuffer>, salt: Uint8Array<ArrayBuffer>, info: Uint8Array<ArrayBuffer>, bits: number): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bits));
}

/** RFC 8291: one aes128gcm record addressed to the subscription's key. */
export async function encryptPayload(sub: PushSubscription, plaintext: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const uaPublic = b64urlDecode(sub.keys.p256dh);
  const authSecret = b64urlDecode(sub.keys.auth);

  const ephemeral = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const asPublic = new Uint8Array((await crypto.subtle.exportKey("raw", ephemeral.publicKey)) as ArrayBuffer);
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey } as never, ephemeral.privateKey, 256));

  const salt = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(16)));
  const ikm = await hkdf(bytes(shared), authSecret, bytes(text.encode("WebPush: info\0"), uaPublic, asPublic), 256);
  const cek = await hkdf(ikm, salt, bytes(text.encode("Content-Encoding: aes128gcm\0")), 128);
  const nonce = await hkdf(ikm, salt, bytes(text.encode("Content-Encoding: nonce\0")), 96);

  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aes, bytes(plaintext, [2]))); // 0x02 = last record

  const header = bytes(salt, [(RECORD_SIZE >>> 24) & 255, (RECORD_SIZE >>> 16) & 255, (RECORD_SIZE >>> 8) & 255, RECORD_SIZE & 255], [asPublic.length], asPublic);
  return bytes(header, cipher);
}

/** Sends one notification. Throws an Error with `statusCode` when the push service refuses (410/404 = gone). */
export async function sendWebPush(sub: PushSubscription, payload: string, vapid: Vapid, subject: string, now: number = Date.now()): Promise<void> {
  const jwt = await signVapidJwt(new URL(sub.endpoint).origin, vapid, subject, now);
  const res = await fetch(sub.endpoint, {
    method: "POST",
    redirect: "manual",
    signal: AbortSignal.timeout(8000),
    headers: {
      Authorization: `vapid t=${jwt}, k=${vapid.publicKey}`,
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: "3600",
      Urgency: "high",
    },
    body: await encryptPayload(sub, text.encode(payload)),
  });
  if (!res.ok) throw Object.assign(new Error(`Push service answered ${res.status}`), { statusCode: res.status });
}
