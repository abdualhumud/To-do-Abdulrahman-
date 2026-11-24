// Web Push: the receiving side is implemented here from RFC 8291 to prove the encrypted body can be read.
import { test } from "node:test";
import assert from "node:assert/strict";
import { b64urlDecode, b64urlEncode, encryptPayload, generateVapidKeys, sendWebPush } from "../../telegram-bot/lib/webpush.ts";

import { decrypt, subscriber } from "./helpers/webpush-receiver.ts";

const text = new TextEncoder();

test("the encrypted body has the RFC 8291 header and decrypts to the original payload", async () => {
  const s = await subscriber();
  const message = JSON.stringify({ title: "⏰ اتصل بأمي", body: "17:00" });
  const body = await encryptPayload(s.sub, text.encode(message));
  const out = await decrypt(body, s);
  assert.equal(out.plain, message);
  assert.deepEqual([out.saltLen, out.rs, out.idLen], [16, 4096, 65]);
});

test("every message uses a fresh salt and ephemeral key", async () => {
  const s = await subscriber();
  const a = await encryptPayload(s.sub, text.encode("same"));
  const b = await encryptPayload(s.sub, text.encode("same"));
  assert.notDeepEqual(a.slice(0, 16), b.slice(0, 16));
  assert.notDeepEqual(a.slice(21, 86), b.slice(21, 86));
});

test("another subscriber cannot decrypt it", async () => {
  const mine = await subscriber();
  const other = await subscriber();
  const body = await encryptPayload(mine.sub, text.encode("secret"));
  await assert.rejects(() => decrypt(body, other));
});

test("VAPID keys have the right shape and sign a verifiable ES256 token", async () => {
  const vapid = await generateVapidKeys();
  assert.equal(b64urlDecode(vapid.publicKey).length, 65);
  assert.equal(b64urlDecode(vapid.privateKey).length, 32);

  const s = await subscriber();
  let sent: { url: string; init: RequestInit } | null = null;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => { sent = { url, init }; return new Response(null, { status: 201 }); }) as typeof fetch;
  try {
    const now = Date.UTC(2026, 10, 24, 12);
    await sendWebPush(s.sub, JSON.stringify({ title: "x" }), vapid, "mailto:me@example.com", now);
  } finally {
    globalThis.fetch = realFetch;
  }
  const h = sent!.init.headers as Record<string, string>;
  assert.equal(sent!.url, s.sub.endpoint);
  assert.deepEqual([h["Content-Encoding"], h.TTL, h.Urgency], ["aes128gcm", "3600", "high"]);

  const m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(h.Authorization);
  assert.ok(m, "Authorization must be 'vapid t=<jwt>, k=<public key>'");
  assert.equal(m![4], vapid.publicKey);
  const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(m![2])));
  assert.deepEqual([claims.aud, claims.sub, claims.exp], ["https://push.example.net", "mailto:me@example.com", Math.floor(Date.UTC(2026, 10, 24, 12) / 1000) + 12 * 3600]);

  const pub = b64urlDecode(vapid.publicKey);
  const key = await crypto.subtle.importKey("raw", pub, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  const valid = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, b64urlDecode(m![3]), text.encode(`${m![1]}.${m![2]}`));
  assert.equal(valid, true);
});

test("a refusing push service becomes an error carrying its status (410 = subscription gone)", async () => {
  const s = await subscriber();
  const vapid = await generateVapidKeys();
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(null, { status: 410 })) as typeof fetch;
  try {
    await assert.rejects(() => sendWebPush(s.sub, "{}", vapid, "mailto:a@b.c"), (e: Error & { statusCode?: number }) => e.statusCode === 410);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("base64url round-trips arbitrary bytes", () => {
  const data = crypto.getRandomValues(new Uint8Array(257));
  assert.deepEqual(b64urlDecode(b64urlEncode(data)), data);
});
