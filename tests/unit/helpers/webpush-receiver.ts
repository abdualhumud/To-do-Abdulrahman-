// The receiving side of Web Push (RFC 8291), used to prove our encrypted bodies are readable.
import assert from "node:assert/strict";
import { b64urlEncode, type PushSubscription } from "../../../telegram-bot/lib/webpush";

const text = new TextEncoder();
export type Subscriber = Awaited<ReturnType<typeof subscriber>>;
const cat = (...p: (Uint8Array | number[])[]) => {
  const out = new Uint8Array(p.reduce((n, x) => n + x.length, 0));
  let at = 0;
  for (const x of p) { out.set(x, at); at += x.length; }
  return out;
};

/** A browser's side: key pair + auth secret, as found in PushSubscription.toJSON(). */
export async function subscriber() {
  const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const publicRaw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const sub: PushSubscription = { endpoint: "https://push.example.net/send/abc", keys: { p256dh: b64urlEncode(publicRaw), auth: b64urlEncode(auth) } };
  return { pair, publicRaw, auth, sub };
}

async function hkdf(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, bits: number) {
  const key = await crypto.subtle.importKey("raw", ikm as BufferSource, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: salt as BufferSource, info: info as BufferSource }, key, bits));
}

export async function decrypt(body: Uint8Array, s: Awaited<ReturnType<typeof subscriber>>) {
  const salt = body.slice(0, 16);
  const rs = new DataView(body.buffer, body.byteOffset + 16, 4).getUint32(0);
  const idLen = body[20];
  const asPublic = body.slice(21, 21 + idLen);
  const cipher = body.slice(21 + idLen);
  const asKey = await crypto.subtle.importKey("raw", asPublic as BufferSource, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: asKey }, s.pair.privateKey, 256));
  const ikm = await hkdf(shared, s.auth, cat(text.encode("WebPush: info\0"), s.publicRaw, asPublic), 256);
  const cek = await hkdf(ikm, salt, text.encode("Content-Encoding: aes128gcm\0"), 128);
  const nonce = await hkdf(ikm, salt, text.encode("Content-Encoding: nonce\0"), 96);
  const aes = await crypto.subtle.importKey("raw", cek as BufferSource, "AES-GCM", false, ["decrypt"]);
  const record = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce as BufferSource }, aes, cipher as BufferSource));
  let end = record.length;
  while (end > 0 && record[end - 1] === 0) end--; // strip zero padding
  assert.equal(record[end - 1], 2, "last record must end with the 0x02 delimiter");
  return { plain: new TextDecoder().decode(record.slice(0, end - 1)), rs, idLen, saltLen: salt.length };
}

