"use client";

/** Phone/desktop push notifications: this device subscribes and the bot server sends to it. */

import { tr } from "@/lib/i18n";
import { localPrefs } from "@/lib/local-store";
import { appDashboardUrl, authHeader, serverConfig } from "@/lib/reminders";
import { server, type ServerStatus } from "@/lib/telegram";

export function pushSupport(): { supported: boolean; reason?: string } {
  if (typeof window === "undefined") return { supported: false };
  if ("serviceWorker" in navigator && "PushManager" in window && "Notification" in window) return { supported: true };
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
  return {
    supported: false,
    reason: ios
      ? tr("On iPhone, push notifications only work for a web app added to the Home Screen: Share → Add to Home Screen, then open TaskFlow from there (it keeps its own data, so connect the bot server there too). Telegram reminders work everywhere.")
      : tr("This browser doesn't support push notifications. Telegram reminders work everywhere."),
  };
}

function keyBytes(base64Url: string): Uint8Array<ArrayBuffer> {
  const padded = base64Url.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(base64Url.length / 4) * 4, "=");
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function appRoot(): string {
  return appDashboardUrl().replace(/dashboard\/$/, "");
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const root = appRoot();
  const reg = await navigator.serviceWorker.register(`${root}sw.js`, { scope: root });
  await navigator.serviceWorker.ready;
  return reg;
}

export async function enablePush(): Promise<void> {
  const cfg = serverConfig();
  if (!cfg) throw new Error(tr("Connect the bot server first (Settings → Telegram)"));
  const support = pushSupport();
  if (!support.supported) throw new Error(support.reason);
  if ((await Notification.requestPermission()) !== "granted") throw new Error(tr("Notifications are blocked for this site — allow them in the browser settings"));

  const status = await server<ServerStatus>(cfg.serverUrl, "/api/status");
  if (!status.vapidPublicKey) throw new Error(tr("The server has no push keys yet — check Redis in Check connection"));

  const reg = await registration();
  await (await reg.pushManager.getSubscription())?.unsubscribe(); // a stale key would make subscribe() fail
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(status.vapidPublicKey) });
  await server(cfg.serverUrl, "/api/push", {
    method: "POST",
    headers: { ...authHeader(cfg), "Content-Type": "application/json" },
    body: JSON.stringify({ subscription: sub.toJSON() }),
  });
  localPrefs.patch({ pushDevice: true });
}

export async function disablePush(): Promise<void> {
  const cfg = serverConfig();
  const reg = await navigator.serviceWorker?.getRegistration(appRoot());
  const sub = await reg?.pushManager.getSubscription();
  if (cfg && sub) {
    await server(cfg.serverUrl, "/api/push", {
      method: "DELETE",
      headers: { ...authHeader(cfg), "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    }).catch(() => undefined);
  }
  await sub?.unsubscribe();
  localPrefs.patch({ pushDevice: false });
}
