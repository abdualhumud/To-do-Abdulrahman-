/**
 * Recurrence and time-zone arithmetic shared by the app and the Vercel server.
 * Pure and dependency-free (Intl only). "Wall-clock" semantics: a reminder set for 17:00 every
 * day stays at 17:00 local time across daylight-saving changes.
 */

export type Repeat = "none" | "daily" | "weekly" | "monthly" | "mon-fri" | "sun-thu";

export const REPEATS: Repeat[] = ["none", "daily", "mon-fri", "sun-thu", "weekly", "monthly"];

export const REPEAT_LABELS: Record<Repeat, string> = {
  none: "Does not repeat",
  daily: "Every day",
  "mon-fri": "Mon – Fri",
  "sun-thu": "Sun – Thu (work week)",
  weekly: "Every week",
  monthly: "Every month",
};

export const DAY_MS = 86_400_000;
/** A reminder this much past its time is still sent late; older ones are dropped, not flooded. */
export const GRACE_MS = 2 * 60 * 60 * 1000;

export function isRepeat(value: unknown): value is Repeat {
  return typeof value === "string" && (REPEATS as string[]).includes(value);
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export interface Zoned {
  y: number;
  m: number; // 1-12
  d: number;
  h: number;
  mi: number;
  s: number;
  weekday: number; // 0 = Sunday
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formatters.set(tz, f);
  }
  return f;
}

/** Calendar fields of an instant as seen in `tz`. */
export function zonedParts(ms: number, tz: string): Zoned {
  const parts = formatter(tz).formatToParts(new Date(ms));
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const y = n("year");
  const m = n("month");
  const d = n("day");
  return { y, m, d, h: n("hour") % 24, mi: n("minute"), s: n("second"), weekday: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
}

function offsetAt(ms: number, tz: string): number {
  const p = zonedParts(ms, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000;
}

/** The instant at which the wall clock in `tz` reads y-m-d h:mi (day overflow such as d=32 is allowed). */
export function zonedToEpoch(y: number, m: number, d: number, h: number, mi: number, tz: string): number {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const first = guess - offsetAt(guess, tz);
  const second = guess - offsetAt(first, tz); // second pass settles instants near a DST change
  return second;
}

const WORKDAYS: Record<"mon-fri" | "sun-thu", number[]> = { "mon-fri": [1, 2, 3, 4, 5], "sun-thu": [0, 1, 2, 3, 4] };

/** First occurrence strictly after `after` (the anchor itself counts as the first occurrence). */
export function occurrenceAfter(anchor: number, repeat: Repeat, tz: string, after: number): number | null {
  if (repeat === "none") return anchor > after ? anchor : null;
  const a = zonedParts(anchor, tz);

  if (repeat === "monthly") {
    const start = Math.max(0, Math.floor((after - anchor) / (31 * DAY_MS)) - 1);
    for (let k = start; k < start + 1200; k++) {
      const total = a.m - 1 + k;
      const y = a.y + Math.floor(total / 12);
      const month = total % 12;
      const daysInMonth = new Date(Date.UTC(y, month + 1, 0)).getUTCDate();
      const t = zonedToEpoch(y, month + 1, Math.min(a.d, daysInMonth), a.h, a.mi, tz);
      if (t > after) return t;
    }
    return null;
  }

  const allowed = repeat === "mon-fri" || repeat === "sun-thu" ? WORKDAYS[repeat] : null;
  const first = Math.max(0, Math.floor((after - anchor) / DAY_MS) - 2);
  const start = repeat === "weekly" ? Math.ceil(first / 7) * 7 : first;
  const step = repeat === "weekly" ? 7 : 1;
  for (let k = start; k < start + 3000; k += step) {
    if (allowed && !allowed.includes(new Date(Date.UTC(a.y, a.m - 1, a.d + k)).getUTCDay())) continue;
    const t = zonedToEpoch(a.y, a.m, a.d + k, a.h, a.mi, tz);
    if (t > after && t >= anchor) return t;
  }
  return null;
}

export interface ReminderSpec {
  anchor: number;
  repeat: Repeat;
  tz: string;
}

/**
 * When a reminder should fire next, given the last occurrence already delivered.
 * One-off reminders fire once; repeating ones skip occurrences missed by more than GRACE_MS.
 */
export function nextFire(spec: ReminderSpec, lastFired: number | null, now: number, graceMs = GRACE_MS): number | null {
  if (spec.repeat === "none") {
    if (lastFired === spec.anchor) return null;
    return spec.anchor >= now - graceMs ? spec.anchor : null;
  }
  const after = Math.max(lastFired ?? spec.anchor - 1, now - graceMs);
  return occurrenceAfter(spec.anchor, spec.repeat, spec.tz, after);
}

/** Human-readable local time, e.g. "17 Nov 2026, 17:00". */
export function formatZoned(ms: number, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, dateStyle: "medium", timeStyle: "short" }).format(new Date(ms));
}
