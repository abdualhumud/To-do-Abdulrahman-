"use client";

import { useEffect } from "react";
import toast from "react-hot-toast";
import { onExternalChange } from "@/lib/local-store";
import { useTelegramConfig } from "@/lib/use-local-store";
import { processCaptureRequest } from "@/lib/capture";
import { pollTelegram } from "@/lib/telegram";
import { useTaskStore } from "@/store/useTaskStore";
import { useHabitStore } from "@/store/useHabitStore";

const PAIRING_POLL_MS = 4_000;
const SYNC_POLL_MS = 30_000;

/** Side effects shared by every signed-in page. Renders nothing. */
export function AppBootstrap() {
  // Load data once, and again whenever another tab changes it.
  useEffect(() => {
    const refresh = () => {
      void useTaskStore.getState().fetchTasks();
      void useTaskStore.getState().fetchTags();
      void useHabitStore.getState().fetchHabits();
    };
    refresh();
    return onExternalChange(refresh);
  }, []);

  // Tasks added through a link (Apple Shortcuts, Notes, bookmarklet, Siri…).
  useEffect(() => {
    processCaptureRequest()
      .then((titles) => {
        if (titles.length === 1) toast.success(`Added: ${titles[0]}`);
        else if (titles.length > 1) toast.success(`Added ${titles.length} tasks`);
      })
      .catch(() => toast.error("Couldn't add the task from that link"));
  }, []);

  return <TelegramSync />;
}

function TelegramSync() {
  const config = useTelegramConfig();
  const connected = config !== null;
  const interval = config?.chatId ? SYNC_POLL_MS : PAIRING_POLL_MS;

  useEffect(() => {
    if (!connected) return;
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      pollTelegram()
        .then(({ added, linked }) => {
          if (linked) toast.success("Telegram linked");
          if (added.length > 0) toast.success(`Telegram: added ${added.length} task${added.length === 1 ? "" : "s"}`);
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
