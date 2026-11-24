"use client";

import { useEffect } from "react";
import toast from "react-hot-toast";
import { onExternalChange } from "@/lib/local-store";
import { useTelegramConfig } from "@/lib/use-local-store";
import { processCaptureRequest } from "@/lib/capture";
import { isLinked, pollTelegram } from "@/lib/telegram";
import { refreshStores } from "@/lib/refresh";
import { startSyncRuntime } from "@/lib/sync";
import { tr } from "@/lib/i18n";
import { ReminderRuntime } from "@/components/providers/ReminderRuntime";

const PAIRING_POLL_MS = 4_000;
const SYNC_POLL_MS = 30_000;

/** Side effects shared by every signed-in page. Renders nothing. */
export function AppBootstrap() {
  // Load data once, and again whenever another tab changes it.
  useEffect(() => {
    refreshStores();
    return onExternalChange(refreshStores);
  }, []);

  // Tasks added through a link (Apple Shortcuts, Notes, bookmarklet, Siri…).
  useEffect(() => {
    processCaptureRequest()
      .then((titles) => {
        if (titles.length === 1) toast.success(tr("Added: {title}", { title: titles[0] }));
        else if (titles.length > 1) toast.success(tr("Added {n} tasks", { n: titles.length }));
      })
      .catch(() => toast.error(tr("Couldn't add the task from that link")));
  }, []);

  return (
    <>
      <SyncRuntime />
      <TelegramSync />
      <ReminderRuntime />
    </>
  );
}

function TelegramSync() {
  const config = useTelegramConfig();
  const connected = config !== null;
  const interval = config && isLinked(config) ? SYNC_POLL_MS : PAIRING_POLL_MS;

  useEffect(() => {
    if (!connected) return;
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      pollTelegram()
        .then(({ added, linked }) => {
          if (linked) toast.success(tr("Telegram linked"));
          if (added.length > 0) toast.success(added.length === 1 ? tr("Telegram: added 1 task") : tr("Telegram: added {n} tasks", { n: added.length }));
        })
        .catch(() => undefined);
    };
    tick();
    const id = setInterval(tick, interval);
    const resume = ["focus", "pageshow", "online"] as const;
    resume.forEach((name) => window.addEventListener(name, tick));
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      resume.forEach((name) => window.removeEventListener(name, tick));
      document.removeEventListener("visibilitychange", tick);
    };
  }, [connected, interval]);

  return null;
}

function SyncRuntime() {
  useEffect(() => startSyncRuntime(), []);
  return null;
}
