"use client";

import { useEffect, useState } from "react";
import { BellRing, CalendarDays, Check, Copy, Download, Loader2, RefreshCw, Send } from "lucide-react";
import toast from "react-hot-toast";
import { fmtTime, useT } from "@/lib/i18n";
import { localPrefs } from "@/lib/local-store";
import { usePrefs, useTelegramConfig } from "@/lib/use-local-store";
import { isLinked, server, type ServerStatus } from "@/lib/telegram";
import { askNotificationPermission, clearServerCopy, notificationsSupported, sendTestReminder, syncReminders, useSyncState } from "@/lib/reminders";
import { createFeedUrls, downloadIcs } from "@/lib/calendar";
import { disablePush, enablePush, pushSupport } from "@/lib/push";
import { useTaskStore } from "@/store/useTaskStore";
import type { ReminderChannel } from "@/types";

const DEFAULT_CHANNEL_LABELS: Record<ReminderChannel, string> = { inapp: "In app", telegram: "Telegram", email: "Email", push: "Phone" };

export function RemindersCard() {
  const t = useT();
  const cfg = useTelegramConfig();
  const prefs = usePrefs();
  const sync = useSyncState();
  const tasks = useTaskStore((s) => s.tasks);
  const serverMode = cfg?.mode === "server";
  const [caps, setCaps] = useState<ServerStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [feed, setFeed] = useState<{ https: string; webcal: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(() =>
    notificationsSupported() ? Notification.permission : "unsupported",
  );
  const push = pushSupport();

  useEffect(() => {
    if (!cfg || cfg.mode !== "server") return;
    let alive = true;
    server<ServerStatus>(cfg.serverUrl, "/api/status").then((r) => alive && setCaps(r)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [cfg]);

  async function run(label: string, action: () => Promise<void>) {
    setBusy(label);
    try {
      await action();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Something went wrong"));
    } finally {
      setBusy(null);
    }
  }

  const setSync = (on: boolean) =>
    run("sync", async () => {
      localPrefs.patch({ syncToServer: on });
      if (on) {
        const s = await syncReminders(true);
        toast.success(s ? t("Server updated · {reminders} reminders, {calendar} calendar items", { reminders: s.reminders, calendar: s.calendar }) : t("Sync is on"));
      } else {
        await clearServerCopy();
        setFeed(null);
        toast.success(t("The server's copy was deleted"));
      }
    });

  const test = (channel: "telegram" | "email" | "push") =>
    run(`test-${channel}`, async () => {
      const r = await sendTestReminder(channel);
      if (r.delivered) toast.success(t("Test sent ({detail})", { detail: r.detail }));
      else toast.error(r.detail);
    });

  const toggleDefault = (c: ReminderChannel) => {
    const has = prefs.defaultChannels.includes(c);
    localPrefs.patch({ defaultChannels: has ? prefs.defaultChannels.filter((x) => x !== c) : [...prefs.defaultChannels, c] });
  };

  const openDated = tasks.filter((task) => task.status !== "completed" && task.status !== "cancelled" && (task.due_date || task.reminder_at));
  const telegramLinked = cfg ? isLinked(cfg) : false;

  async function copyFeed() {
    if (!feed) return;
    try {
      await navigator.clipboard.writeText(feed.https);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error(t("Couldn't copy — select the link and copy it manually"));
    }
  }

  return (
    <div className="card p-5 space-y-5">
      <div className="flex items-center gap-2">
        <BellRing className="w-4 h-4 text-secondary-fg" />
        <h2 className="font-semibold text-base-fg">{t("Reminders & calendar")}</h2>
      </div>

      {/* In-app alerts: no server needed */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-base-fg">{t("While TaskFlow is open")}</h3>
        <p className="text-xs text-secondary-fg">{t("Tasks with a reminder show an alert here when their time comes.")}</p>
        {permission === "unsupported" ? (
          <p className="text-xs text-muted-fg">{t("This browser can't show system notifications; you'll still see in-app alerts.")}</p>
        ) : permission === "granted" ? (
          <p className="text-xs text-success">{t("System notifications are allowed.")}</p>
        ) : (
          <button className="btn-secondary text-xs" onClick={async () => setPermission(await askNotificationPermission())}>
            {t("Allow system notifications")}
          </button>
        )}
      </div>

      {/* Server-delivered reminders */}
      <div className="space-y-3 border-t border-base pt-4">
        <h3 className="text-sm font-semibold text-base-fg">{t("When the app is closed")}</h3>
        {!serverMode ? (
          <p className="text-sm text-secondary-fg">
            {t("Telegram, email and phone reminders are delivered by your bot server so they arrive even when TaskFlow is closed.")}{" "}
            {t("Connect the server in Telegram above, then come back here.")}
          </p>
        ) : (
          <>
            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" className="mt-1" checked={prefs.syncToServer} disabled={busy === "sync"} onChange={(e) => void setSync(e.target.checked)} />
              <span className="text-sm text-secondary-fg">
                <strong className="text-base-fg">{t("Keep reminders on my server.")}</strong> {t("Stores a copy of your open tasks that have a due date or reminder (title, notes, time) on your server, so reminders can be sent and the calendar link kept up to date. Turn off to delete it.")}
              </span>
            </label>

            {prefs.syncToServer && (
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-fg">
                <button className="btn-ghost text-xs px-2 py-1" disabled={busy === "sync"} onClick={() => void run("sync", async () => { await syncReminders(true); })}>
                  <RefreshCw className={`w-3.5 h-3.5 ${busy === "sync" ? "animate-spin" : ""}`} /> {t("Sync now")}
                </button>
                {sync.summary && <span>{t("{reminders} reminders · {calendar} in calendar", { reminders: sync.summary.reminders, calendar: sync.summary.calendar })}</span>}
                {sync.lastSync && <span>· {t("last sync")} {fmtTime(new Date(sync.lastSync))}</span>}
                {sync.error && <span className="text-danger">{sync.error}</span>}
              </div>
            )}

            <ul className="space-y-2.5">
              <li className="flex flex-wrap items-center gap-2 text-sm">
                <span className="w-20 font-medium text-base-fg">{t("Telegram")}</span>
                <span className={telegramLinked ? "text-success text-xs" : "text-warning text-xs"}>{telegramLinked ? t("linked") : t("not linked yet")}</span>
                <button className="btn-ghost text-xs px-2 py-1 ms-auto" disabled={busy !== null || !telegramLinked} onClick={() => void test("telegram")}>
                  {busy === "test-telegram" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Send test
                </button>
              </li>
              <li className="flex flex-wrap items-center gap-2 text-sm">
                <span className="w-20 font-medium text-base-fg">{t("Email")}</span>
                <span className={caps?.email?.configured ? "text-success text-xs" : "text-warning text-xs"}>
                  {caps === null ? t("checking…") : caps.email?.configured ? t("to {email}", { email: caps.email.to ?? "" }) : t("not set up on the server (RESEND_API_KEY, REMINDER_EMAIL_TO)")}
                </span>
                <button className="btn-ghost text-xs px-2 py-1 ms-auto" disabled={busy !== null || !caps?.email?.configured} onClick={() => void test("email")}>
                  {busy === "test-email" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Send test
                </button>
              </li>
              <li className="flex flex-wrap items-center gap-2 text-sm">
                <span className="w-20 font-medium text-base-fg">{t("Phone")}</span>
                <span className={prefs.pushDevice ? "text-success text-xs" : "text-muted-fg text-xs"}>{prefs.pushDevice ? t("this device is registered") : t("this device is not registered")}</span>
                <span className="ms-auto flex items-center gap-1">
                  {prefs.pushDevice && (
                    <button className="btn-ghost text-xs px-2 py-1" disabled={busy !== null} onClick={() => void test("push")}>
                      {busy === "test-push" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Send test
                    </button>
                  )}
                  <button
                    className="btn-secondary text-xs px-2 py-1"
                    disabled={busy !== null || !push.supported}
                    onClick={() => void run("push", async () => { if (prefs.pushDevice) await disablePush(); else { await enablePush(); toast.success(t("This device will get reminder notifications")); } })}
                  >
                    {busy === "push" && <Loader2 className="w-3.5 h-3.5 animate-spin" />} {prefs.pushDevice ? t("Turn off") : t("Enable on this device")}
                  </button>
                </span>
              </li>
            </ul>
            {!push.supported && push.reason && <p className="text-xs text-muted-fg leading-relaxed">{push.reason}</p>}
          </>
        )}

        <div>
          <p className="text-xs font-medium text-secondary-fg mb-1.5">{t("Pre-selected for new reminders")}</p>
          <div className="flex flex-wrap gap-3">
            {(Object.keys(DEFAULT_CHANNEL_LABELS) as ReminderChannel[]).map((c) => (
              <label key={c} className="flex items-center gap-1.5 text-xs text-secondary-fg cursor-pointer">
                <input type="checkbox" checked={prefs.defaultChannels.includes(c)} onChange={() => toggleDefault(c)} /> {t(DEFAULT_CHANNEL_LABELS[c])}
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* Calendar */}
      <div className="space-y-3 border-t border-base pt-4">
        <h3 className="text-sm font-semibold text-base-fg flex items-center gap-2"><CalendarDays className="w-4 h-4" /> {t("Apple Calendar & Outlook")}</h3>
        <p className="text-xs text-secondary-fg">
          {t("Add a single task from its calendar button. Or send everything at once, or subscribe so tasks appear in your calendar and stay up to date.")}
        </p>
        <button className="btn-secondary text-sm" disabled={openDated.length === 0} onClick={() => downloadIcs(openDated)}>
          <Download className="w-4 h-4" /> {openDated.length === 1 ? t("Download 1 open task (.ics)") : t("Download {n} open tasks (.ics)", { n: openDated.length })}
        </button>

        {serverMode && (
          <div className="space-y-2">
            <button
              className="btn-secondary text-sm"
              disabled={busy !== null || !prefs.syncToServer}
              onClick={() => void run("feed", async () => setFeed(await createFeedUrls()))}
              title={prefs.syncToServer ? undefined : t("Turn on “Keep reminders on my server” first")}
            >
              {busy === "feed" && <Loader2 className="w-4 h-4 animate-spin" />} {t("Create subscription link")}
            </button>
            {feed && (
              <div className="space-y-2 animate-slide-up">
                <div className="flex items-stretch gap-2">
                  <code className="flex-1 min-w-0 bg-secondary rounded-lg px-3 py-2 text-xs break-all select-all" dir="ltr">{feed.https}</code>
                  <button className="btn-secondary px-3" onClick={() => void copyFeed()} aria-label={t("Copy subscription link")}>
                    {copied ? <Check className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
                <a href={feed.webcal} className="btn-primary text-sm inline-flex">{t("Open in Calendar app")}</a>
                <ul className="text-xs text-secondary-fg space-y-1 list-disc ps-5">
                  <li><strong>iPhone:</strong> {t("Settings → Calendar → Accounts → Add Account → Other → Add Subscribed Calendar, paste the link.")}</li>
                  <li><strong>Mac:</strong> {t("Calendar → File → New Calendar Subscription.")}</li>
                  <li><strong>Outlook (web / Microsoft 365):</strong> {t("Add calendar → Subscribe from web.")} <strong>Outlook desktop:</strong> {t("Add Calendar → From Internet.")}</li>
                  <li>{t("Calendar apps refresh subscriptions on their own schedule (Apple about hourly; Outlook can take several hours). Keep the link private — anyone with it can read your dated tasks.")}</li>
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
