/**
 * Minimal, strict iCalendar (RFC 5545) writer used by the app (one-off downloads) and the
 * server (subscribable feed). Output works in Apple Calendar and Outlook.
 *
 * Time rules: one-off timed events use UTC instants; recurring events use floating local time so
 * "every day at 17:00" survives daylight-saving changes without needing VTIMEZONE blocks.
 */

import { zonedParts, type Repeat, type Zoned } from "./recurrence";

export interface CalendarItem {
  id: string;
  title: string;
  description?: string | null;
  due_date?: string | null; // yyyy-MM-dd
  reminder_at?: number | null; // epoch ms
  repeat?: Repeat;
  tz?: string;
  priority?: "low" | "medium" | "high" | "urgent";
  category?: string | null;
  /** Add a display alarm so the calendar app itself notifies (works on iPhone/Android/Outlook). */
  alarm?: boolean;
}

const EVENT_MINUTES = 30;
const ALL_DAY_ALARM_HOURS = 9;
const PRIORITY: Record<NonNullable<CalendarItem["priority"]>, number> = { urgent: 1, high: 3, medium: 5, low: 9 };

const RRULES: Record<Exclude<Repeat, "none">, string> = {
  daily: "FREQ=DAILY",
  weekly: "FREQ=WEEKLY",
  monthly: "FREQ=MONTHLY",
  "mon-fri": "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
  "sun-thu": "FREQ=WEEKLY;BYDAY=SU,MO,TU,WE,TH",
};

const pad = (n: number, len = 2) => String(n).padStart(len, "0");

export function escapeText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Fold a content line at 75 octets without splitting a multi-byte character. */
export function fold(line: string): string {
  const enc = new TextEncoder();
  const out: string[] = [];
  let current = "";
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const size = enc.encode(ch).length;
    if (bytes + size > limit) {
      out.push(current);
      current = "";
      bytes = 0;
      limit = 74; // continuation lines start with one space
    }
    current += ch;
    bytes += size;
  }
  out.push(current);
  return out.join("\r\n ");
}

function utc(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

function floating(p: Zoned): string {
  return `${p.y}${pad(p.m)}${pad(p.d)}T${pad(p.h)}${pad(p.mi)}${pad(p.s)}`;
}

function dateOnly(isoDate: string, plusDays = 0): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + plusDays));
  return `${t.getUTCFullYear()}${pad(t.getUTCMonth() + 1)}${pad(t.getUTCDate())}`;
}

/** VEVENT lines for one item, or null when it has neither a due date nor a reminder time. */
export function eventLines(item: CalendarItem, now: number): string[] | null {
  const tz = item.tz ?? "UTC";
  const repeat = item.repeat ?? "none";
  const lines = ["BEGIN:VEVENT", `UID:${item.id}@taskflow`, `DTSTAMP:${utc(now)}`, `SUMMARY:${escapeText(item.title)}`];

  const notes = [item.description?.trim(), item.due_date ? `Due: ${item.due_date}` : ""].filter(Boolean).join("\n");
  let allDay = false;

  if (item.reminder_at) {
    if (repeat === "none") {
      lines.push(`DTSTART:${utc(item.reminder_at)}`, `DTEND:${utc(item.reminder_at + EVENT_MINUTES * 60_000)}`);
    } else {
      lines.push(
        `DTSTART:${floating(zonedParts(item.reminder_at, tz))}`,
        `DTEND:${floating(zonedParts(item.reminder_at + EVENT_MINUTES * 60_000, tz))}`,
      );
    }
  } else if (item.due_date && /^\d{4}-\d{2}-\d{2}$/.test(item.due_date)) {
    allDay = true;
    lines.push(`DTSTART;VALUE=DATE:${dateOnly(item.due_date)}`, `DTEND;VALUE=DATE:${dateOnly(item.due_date, 1)}`);
  } else {
    return null;
  }

  if (repeat !== "none") lines.push(`RRULE:${RRULES[repeat]}`);
  if (notes) lines.push(`DESCRIPTION:${escapeText(notes)}`);
  if (item.category) lines.push(`CATEGORIES:${escapeText(item.category)}`);
  if (item.priority) lines.push(`PRIORITY:${PRIORITY[item.priority]}`);
  lines.push("STATUS:CONFIRMED", allDay ? "TRANSP:TRANSPARENT" : "TRANSP:OPAQUE");

  if (item.alarm !== false) {
    lines.push(
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `DESCRIPTION:${escapeText(item.title)}`,
      allDay ? `TRIGGER:PT${ALL_DAY_ALARM_HOURS}H` : "TRIGGER:PT0S",
      "END:VALARM",
    );
  }
  lines.push("END:VEVENT");
  return lines;
}

/** A complete .ics document (CRLF line endings, folded lines). Items without a date are skipped. */
export function buildCalendar(items: CalendarItem[], now: number, name = "TaskFlow"): string {
  const body = items.flatMap((item) => eventLines(item, now) ?? []);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//TaskFlow//Tasks//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(name)}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
    ...body,
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}
