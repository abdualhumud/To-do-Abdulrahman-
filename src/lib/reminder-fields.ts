import { localPrefs, localTelegram, type LocalTelegram } from "@/lib/local-store";
import type { ParsedTask } from "@/lib/task-parser";
import type { ReminderChannel, Task } from "@/types";
import { formatLocalDate, parseDate } from "@/lib/utils";

/** Helpers that turn text and form values into reminder fields. No network, no store imports. */

export const SERVER_CHANNELS: ReminderChannel[] = ["telegram", "email", "push"];

export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** Absolute URL of the app's dashboard, e.g. https://user.github.io/repo/dashboard/ */
export function appDashboardUrl(): string {
  const root = window.location.pathname.replace(/\/(dashboard|capture|settings|habits|analytics|login|register)\/?$/, "/");
  return `${window.location.origin}${root.endsWith("/") ? root : `${root}/`}dashboard/`;
}

/** The bot-server connection, if the user chose server mode. */
export function serverConfig(): LocalTelegram | null {
  const cfg = localTelegram.get();
  return cfg && cfg.mode === "server" && cfg.serverUrl && cfg.inboxKey ? cfg : null;
}

/** Channels offered for new reminders right now. In-app always works; the rest need the server. */
export function usableChannels(): ReminderChannel[] {
  return serverConfig() ? ["inapp", ...SERVER_CHANNELS] : ["inapp"];
}

export function defaultChannels(): ReminderChannel[] {
  const usable = usableChannels();
  const wanted = localPrefs.get().defaultChannels.filter((c) => usable.includes(c));
  return wanted.length > 0 ? wanted : ["inapp"];
}

// ─── Text → reminder fields ───────────────────────────────────────────────────

/** Builds the task fields for a parsed line, including its reminder when the text had a time. */
export function taskFromParsed(p: ParsedTask, now: Date = new Date()): Partial<Task> {
  const fields: Partial<Task> = {
    title: p.title,
    priority: p.priority,
    category: p.category,
    due_date: p.due_date ?? null,
  };
  const time = p.time ?? (p.repeat ? "09:00" : undefined); // "every day" without a time → 09:00
  if (!time) return fields;

  const [h, mi] = time.split(":").map(Number);
  const day = p.due_date ? parseDate(p.due_date) : new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, mi);
  if (!p.due_date && at.getTime() <= now.getTime()) at = new Date(at.getFullYear(), at.getMonth(), at.getDate() + 1, h, mi);

  fields.reminder_at = at.toISOString();
  fields.repeat = p.repeat ?? "none";
  fields.reminder_channels = defaultChannels();
  if (!p.due_date && fields.repeat === "none") fields.due_date = formatLocalDate(at);
  return fields;
}

/** <input type="datetime-local"> value for an ISO instant, in the device's time zone. */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
