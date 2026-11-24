"use client";

import { useEffect } from "react";
import toast from "react-hot-toast";
import { localPrefs, subscribeStore } from "@/lib/local-store";
import { dueLocalReminders, startReminderSync } from "@/lib/reminders";
import { useTaskStore } from "@/store/useTaskStore";

const TICK_MS = 20_000;

/** Background work for reminders: server sync (opt-in) and alerts while the app is open. */
export function ReminderRuntime() {
  useEffect(() => startReminderSync(subscribeStore), []);

  useEffect(() => {
    const tick = () => {
      const tasks = useTaskStore.getState().tasks;
      const fired = localPrefs.get().firedLocal;
      const due = dueLocalReminders(tasks, Date.now(), fired);
      if (due.length === 0) return;

      const ids = new Set(tasks.map((t) => t.id));
      const next: Record<string, number> = Object.fromEntries(Object.entries(fired).filter(([id]) => ids.has(id)));
      for (const { task, at } of due) {
        next[task.id] = at;
        toast(`⏰ ${task.title}`, { duration: 12_000 });
        try {
          if ("Notification" in window && Notification.permission === "granted") {
            new Notification(`⏰ ${task.title}`, { body: task.description ?? undefined, tag: task.id });
          }
        } catch {
          /* some mobile browsers only allow notifications from a service worker */
        }
      }
      localPrefs.patch({ firedLocal: next });
    };
    tick();
    const id = setInterval(tick, TICK_MS);
    window.addEventListener("focus", tick);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", tick);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);

  return null;
}
