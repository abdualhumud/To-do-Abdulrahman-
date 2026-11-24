"use client";

/**
 * Calendar linking for Apple Calendar and Outlook.
 *  - .ics download of one or many tasks (works offline; events carry an alarm)
 *  - Outlook "add event" links (Microsoft 365 and Outlook.com)
 *  - a subscribable feed URL (webcal://) kept up to date by the bot server
 */

import type { Task } from "@/types";
import { buildCalendar, type CalendarItem } from "../../telegram-bot/lib/ics";
import { authHeader, deviceTimeZone, serverConfig } from "@/lib/reminders";
import { server } from "@/lib/telegram";
import { todayLocal } from "@/lib/utils";
import { tr } from "@/lib/i18n";

const EVENT_MS = 30 * 60_000;

export function toCalendarItem(task: Task): CalendarItem | null {
  const at = task.reminder_at ? Date.parse(task.reminder_at) : NaN;
  if (!task.due_date && !Number.isFinite(at)) return null;
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    due_date: task.due_date,
    reminder_at: Number.isFinite(at) ? at : null,
    repeat: task.repeat ?? "none",
    tz: deviceTimeZone(),
    priority: task.priority,
    category: task.category,
    alarm: true,
  };
}

export function icsForTasks(tasks: Task[], now: number = Date.now()): string {
  return buildCalendar(tasks.flatMap((t) => toCalendarItem(t) ?? []), now, "TaskFlow");
}

export function slug(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "task";
}

export function downloadIcs(tasks: Task[], filename = `taskflow-${todayLocal()}.ics`): void {
  const blob = new Blob([icsForTasks(tasks)], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export type OutlookFlavor = "office" | "live";

/** "Add to Outlook" link. Outlook links cannot carry repetition — use the .ics for repeating tasks. */
export function outlookUrl(task: Task, flavor: OutlookFlavor): string | null {
  const item = toCalendarItem(task);
  if (!item) return null;
  const base = flavor === "office" ? "https://outlook.office.com" : "https://outlook.live.com";
  const params = new URLSearchParams({ path: "/calendar/action/compose", rru: "addevent", subject: task.title });
  const body = [task.description, task.due_date ? tr("Due: {date}", { date: task.due_date }) : ""].filter(Boolean).join("\n");
  if (body) params.set("body", body);
  if (item.reminder_at) {
    params.set("startdt", new Date(item.reminder_at).toISOString());
    params.set("enddt", new Date(item.reminder_at + EVENT_MS).toISOString());
  } else if (task.due_date) {
    const [y, m, d] = task.due_date.split("-").map(Number);
    const next = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
    params.set("startdt", task.due_date);
    params.set("enddt", next);
    params.set("allday", "true");
  }
  return `${base}/calendar/0/deeplink/compose?${params.toString()}`;
}

/** Private subscription link for Apple Calendar / Outlook; needs the bot server. */
export async function createFeedUrls(): Promise<{ https: string; webcal: string }> {
  const cfg = serverConfig();
  if (!cfg) throw new Error(tr("Connect the bot server first (Settings → Telegram)"));
  const out = await server<{ url: string }>(cfg.serverUrl, "/api/feed", { method: "POST", headers: authHeader(cfg) });
  if (!/^https:\/\/[^\s]+$/.test(String(out.url))) throw new Error(tr("The server returned an invalid calendar address"));
  return { https: out.url, webcal: out.url.replace(/^https:/, "webcal:") };
}
