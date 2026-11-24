"use client";

/**
 * Reminders in the app: turning parsed text into reminder fields, syncing dated tasks to the
 * bot server (opt-in), and in-app alerts while TaskFlow is open.
 *
 * Delivery when the app is closed (Telegram / email / phone push) is the server's job — see
 * telegram-bot/lib/reminders.ts. In-app alerts need no server.
 */

import { useSyncExternalStore } from "react";
import { localPrefs, type LocalTelegram } from "@/lib/local-store";
import { server } from "@/lib/telegram";
import { hasUnsyncedChanges, isSyncEnabled } from "@/lib/sync";
import { getSyncStatus, subscribeSyncStatus } from "@/lib/sync-status";
import { useTaskStore } from "@/store/useTaskStore";
import type { Task } from "@/types";
import { deviceTimeZone, appDashboardUrl, serverConfig } from "@/lib/reminder-fields";
import { nextFire } from "../../telegram-bot/lib/recurrence";

export {
  SERVER_CHANNELS,
  appDashboardUrl,
  defaultChannels,
  deviceTimeZone,
  fromLocalInput,
  serverConfig,
  taskFromParsed,
  toLocalInput,
  usableChannels,
} from "@/lib/reminder-fields";

// ─── Sync to the server (opt-in) ──────────────────────────────────────────────

const isOpen = (t: Task) => t.status !== "completed" && t.status !== "cancelled";

export function buildItems(tasks: Task[]) {
  return tasks
    .filter((t) => isOpen(t) && (t.due_date || t.reminder_at))
    .map((t) => {
      const at = t.reminder_at ? Date.parse(t.reminder_at) : NaN;
      return {
        id: t.id,
        title: t.title,
        description: t.description,
        due_date: t.due_date,
        reminder_at: Number.isFinite(at) ? at : null,
        repeat: t.repeat ?? "none",
        channels: (t.reminder_channels ?? []).filter((c) => c !== "inapp"),
        priority: t.priority,
        category: t.category,
      };
    });
}

export interface SyncSummary {
  reminders: number;
  calendar: number;
  nextFire: number | null;
}

interface SyncState {
  lastSync: number | null;
  error: string | null;
  summary: SyncSummary | null;
}
let syncState: SyncState = { lastSync: null, error: null, summary: null };
const syncListeners = new Set<() => void>();
let lastPayload = "";

function setSyncState(next: Partial<SyncState>) {
  syncState = { ...syncState, ...next };
  syncListeners.forEach((cb) => cb());
}

export function useSyncState(): SyncState {
  return useSyncExternalStore(
    (cb) => {
      syncListeners.add(cb);
      return () => syncListeners.delete(cb);
    },
    () => syncState,
    () => syncState,
  );
}

export function authHeader(cfg: LocalTelegram): Record<string, string> {
  return { Authorization: `Bearer ${cfg.inboxKey}` };
}

/** Pushes the current dated tasks to the server. Skips when nothing changed unless `force`. */
export async function syncReminders(force = false): Promise<SyncSummary | null> {
  const cfg = serverConfig();
  if (!cfg || !localPrefs.get().syncToServer) return null;
  // With multi-device sync on, this list is only complete once this device is up to date — otherwise
  // the replace-all copy would drop tasks another device has just added.
  if (isSyncEnabled() && (!getSyncStatus().current || hasUnsyncedChanges())) return null;
  const payload = JSON.stringify({ tz: deviceTimeZone(), appUrl: appDashboardUrl(), items: buildItems(useTaskStore.getState().tasks) });
  if (!force && payload === lastPayload) return syncState.summary;
  try {
    const out = await server<SyncSummary>(cfg.serverUrl, "/api/reminders", {
      method: "PUT",
      headers: { ...authHeader(cfg), "Content-Type": "application/json" },
      body: payload,
    });
    lastPayload = payload;
    setSyncState({ lastSync: Date.now(), error: null, summary: out });
    return out;
  } catch (e) {
    setSyncState({ error: e instanceof Error ? e.message : "Sync failed" });
    return null;
  }
}

/** Server forgot this device's data (or sync was just disabled): remove the copy. */
export async function clearServerCopy(): Promise<void> {
  const cfg = serverConfig();
  if (!cfg) return;
  await server(cfg.serverUrl, "/api/reminders", {
    method: "PUT",
    headers: { ...authHeader(cfg), "Content-Type": "application/json" },
    body: JSON.stringify({ tz: deviceTimeZone(), items: [] }),
  });
  lastPayload = "";
  setSyncState({ summary: { reminders: 0, calendar: 0, nextFire: null } });
}

export async function sendTestReminder(channel: "telegram" | "email" | "push"): Promise<{ delivered: boolean; detail: string }> {
  const cfg = serverConfig();
  if (!cfg) return { delivered: false, detail: "Connect the bot server first" };
  return server<{ delivered: boolean; detail: string }>(cfg.serverUrl, `/api/reminders?test=${channel}`, { method: "POST", headers: authHeader(cfg) });
}

/** Debounced background sync: runs on any task/settings change while server mode is on. */
export function startReminderSync(subscribeStore: (cb: () => void) => () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void syncReminders(), 1500);
  };
  const unsubs = [useTaskStore.subscribe(schedule), subscribeStore(schedule), subscribeSyncStatus(schedule)];
  window.addEventListener("online", schedule);
  schedule();
  return () => {
    clearTimeout(timer);
    unsubs.forEach((u) => u());
    window.removeEventListener("online", schedule);
  };
}

// ─── In-app alerts (no server needed) ─────────────────────────────────────────

/** Reminders with the in-app channel whose time has come and that were not shown yet. */
export function dueLocalReminders(tasks: Task[], now: number, fired: Record<string, number>): { task: Task; at: number }[] {
  const tz = deviceTimeZone();
  const out: { task: Task; at: number }[] = [];
  for (const task of tasks) {
    if (!isOpen(task) || !task.reminder_at || !(task.reminder_channels ?? []).includes("inapp")) continue;
    const anchor = Date.parse(task.reminder_at);
    if (!Number.isFinite(anchor)) continue;
    const fire = nextFire({ anchor, repeat: task.repeat ?? "none", tz }, fired[task.id] ?? null, now);
    if (fire !== null && fire <= now) out.push({ task, at: fire });
  }
  return out;
}

export function notificationsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export async function askNotificationPermission(): Promise<NotificationPermission> {
  if (!notificationsSupported()) return "denied";
  return Notification.permission === "default" ? Notification.requestPermission() : Notification.permission;
}
