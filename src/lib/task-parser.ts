/**
 * task-parser.ts
 * Turns free text ("اشتري حليب بكرة #صحة !مهم", "Call mom on Friday !high") into task fields.
 * Pure functions, shared by quick-add, paste import, link capture and Telegram.
 */

import type { Category, Priority } from "@/types";
import type { Repeat } from "../../telegram-bot/lib/recurrence";

export interface ParsedTask {
  title: string;
  priority?: Priority;
  category?: Category;
  due_date?: string; // yyyy-MM-dd, local time
  /** "HH:mm" local time found in the text ("at 5pm", "الساعة 5 مساء", "17:30"). */
  time?: string;
  repeat?: Repeat;
}

export const MAX_TITLE = 500;
export const MAX_TASKS_PER_BATCH = 100;

const CATEGORIES: Record<string, Category> = {
  work: "work", personal: "personal", health: "health", learning: "learning",
  finance: "finance", social: "social", other: "other",
  "عمل": "work", "شغل": "work", "شخصي": "personal", "صحة": "health", "تعلم": "learning",
  "دراسة": "learning", "مالية": "finance", "مال": "finance", "اجتماعي": "social",
  "أخرى": "other", "اخرى": "other",
};

const PRIORITIES: Record<string, Priority> = {
  low: "low", medium: "medium", high: "high", urgent: "urgent",
  "منخفض": "low", "عادي": "medium", "متوسط": "medium", "مهم": "high",
  "عالي": "high", "عاجل": "urgent", "طارئ": "urgent",
};

const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

function toInt(s: string): number {
  return parseInt(s.replace(/[٠-٩]/g, (d) => String(ARABIC_DIGITS.indexOf(d))), 10);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function formatLocalDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDays(base: Date, days: number): Date {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  d.setDate(d.getDate() + days);
  return d;
}

// `\b` does not work with Arabic, so use explicit Unicode letter/digit boundaries.
const NOT_BEFORE = "(?<![\\p{L}\\p{N}])";
const NOT_AFTER = "(?![\\p{L}\\p{N}])";
function word(src: string): RegExp {
  return new RegExp(`${NOT_BEFORE}(?:${src})${NOT_AFTER}`, "iu");
}

const EN_PREP = "(?:(?:on|by|due|before|until)\\s+)?";
const AR_PREP = "(?:(?:في|يوم)\\s+)?";

interface DateRule {
  re: RegExp;
  resolve: (m: RegExpMatchArray, today: Date) => Date | null;
}

function weekdayRule(en: string, ar: string, day: number): DateRule {
  return {
    re: word(`${EN_PREP}(?:next\\s+)?${en}|${AR_PREP}${ar}`),
    resolve: (_m, today) => {
      let offset = (day - today.getDay() + 7) % 7;
      if (offset === 0) offset = 7;
      return addDays(today, offset);
    },
  };
}

const DATE_RULES: DateRule[] = [
  {
    re: /(?<![\d-])(\d{4})-(\d{2})-(\d{2})(?![\d-])/,
    resolve: (m) => {
      const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
      const date = new Date(y, mo - 1, d);
      return date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d ? date : null;
    },
  },
  {
    re: word(`${EN_PREP}day after tomorrow|${AR_PREP}بعد\\s+(?:غد|غدا|غداً|غدًا|بكرة|بكره|بكرا)`),
    resolve: (_m, t) => addDays(t, 2),
  },
  {
    re: word(`${EN_PREP}(?:tomorrow|tmrw)|${AR_PREP}(?:غدا|غداً|غدًا|بكرة|بكره|بكرا)`),
    resolve: (_m, t) => addDays(t, 1),
  },
  {
    re: word(`${EN_PREP}(?:today|tonight)|${AR_PREP}(?:اليوم|الليلة|الليله)`),
    resolve: (_m, t) => addDays(t, 0),
  },
  {
    re: word(
      `${EN_PREP}next\\s+week|${AR_PREP}(?:الأسبوع|الاسبوع)\\s+(?:القادم|الجاي|المقبل|الجاى)`,
    ),
    resolve: (_m, t) => addDays(t, 7),
  },
  {
    re: word(`${EN_PREP}next\\s+month|${AR_PREP}الشهر\\s+(?:القادم|الجاي|المقبل|الجاى)`),
    resolve: (_m, t) => addDays(t, 30),
  },
  {
    re: word(`${EN_PREP}in\\s+([\\d٠-٩]+)\\s+(days?|weeks?)`),
    resolve: (m, t) => addDays(t, toInt(m[1]) * (m[2].toLowerCase().startsWith("w") ? 7 : 1)),
  },
  {
    re: word(`${AR_PREP}بعد\\s+([\\d٠-٩]+)\\s+(?:يوم|أيام|ايام|اسبوع|أسبوع|أسابيع|اسابيع)`),
    resolve: (m, t) => {
      const unitWeek = /اسبوع|أسبوع|أسابيع|اسابيع/.test(m[0]);
      return addDays(t, toInt(m[1]) * (unitWeek ? 7 : 1));
    },
  },
  weekdayRule("sunday", "الأحد|الاحد", 0),
  weekdayRule("monday", "الاثنين|الإثنين|الأثنين|الاتنين", 1),
  weekdayRule("tuesday", "الثلاثاء|الثلثاء", 2),
  weekdayRule("wednesday", "الأربعاء|الاربعاء|الأربعا", 3),
  weekdayRule("thursday", "الخميس", 4),
  weekdayRule("friday", "الجمعة|الجمعه", 5),
  weekdayRule("saturday", "السبت", 6),
];

/** Finds the first date expression in `text`; returns the date and the text without it. */
export function extractDate(text: string, now: Date = new Date()): { date: string; rest: string } | null {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (const rule of DATE_RULES) {
    const m = text.match(rule.re);
    if (!m) continue;
    const date = rule.resolve(m, today);
    if (!date) continue;
    return { date: formatLocalDate(date), rest: text.replace(m[0], " ") };
  }
  return null;
}

// ─── Time of day ─────────────────────────────────────────────────────────────

type Meridiem = "am" | "pm" | "noon" | "night" | null;

const AR_MERIDIEM: Record<string, Meridiem> = {
  "صباحا": "am", "صباحاً": "am", "فجرا": "am", "فجراً": "am",
  "مساء": "pm", "مساءً": "pm", "عصرا": "pm", "عصراً": "pm",
  "ظهرا": "noon", "ظهراً": "noon", "ليلا": "night", "ليلاً": "night",
};

/** Converts a spoken hour to 24h. Without am/pm, 1–6 is read as afternoon ("at 5" → 17:00). */
function to24h(hour: number, meridiem: Meridiem, hasMinutes: boolean): number | null {
  if (hour > 23) return null;
  if (hour > 12 || hour === 0) return hour;
  switch (meridiem) {
    case "am": return hour === 12 ? 0 : hour;
    case "pm": return hour === 12 ? 12 : hour + 12;
    case "noon": return hour >= 1 && hour <= 5 ? hour + 12 : hour;
    case "night": return hour === 12 ? 0 : hour <= 5 ? hour : hour + 12;
    default: return hasMinutes || hour >= 7 || hour === 12 ? hour : hour + 12;
  }
}

const TIME_RULES: { re: RegExp; read: (m: RegExpMatchArray) => { h: number; mi: number; mer: Meridiem; minutes: boolean } }[] = [
  {
    re: /(?<![\p{L}\p{N}])الساعة\s+([\d٠-٩]{1,2})(?::([\d٠-٩]{2}))?(?:\s*(صباحا|صباحاً|فجرا|فجراً|مساء|مساءً|عصرا|عصراً|ظهرا|ظهراً|ليلا|ليلاً))?(?![\p{L}\p{N}])/u,
    read: (m) => ({ h: toInt(m[1]), mi: m[2] ? toInt(m[2]) : 0, mer: m[3] ? AR_MERIDIEM[m[3]] : null, minutes: Boolean(m[2]) }),
  },
  {
    re: /(?<![\p{L}\p{N}])(?:at|@)\s*(\d{1,2})(?::(\d{2}))?(?:\s*(am|pm))?(?![\p{L}\p{N}:])/iu,
    read: (m) => ({ h: Number(m[1]), mi: m[2] ? Number(m[2]) : 0, mer: m[3] ? (m[3].toLowerCase() as Meridiem) : null, minutes: Boolean(m[2]) }),
  },
  {
    re: /(?<![\p{L}\p{N}.:-])(\d{1,2})(?::(\d{2}))?\s*(am|pm)(?![\p{L}\p{N}])/iu,
    read: (m) => ({ h: Number(m[1]), mi: m[2] ? Number(m[2]) : 0, mer: m[3].toLowerCase() as Meridiem, minutes: Boolean(m[2]) }),
  },
  {
    re: /(?<![\p{L}\p{N}.:-])([01]?\d|2[0-3]):([0-5]\d)(?![\p{L}\p{N}:])/u,
    read: (m) => ({ h: Number(m[1]), mi: Number(m[2]), mer: null, minutes: true }),
  },
];

/** Finds a time of day in `text`; returns "HH:mm" and the text without it. */
export function extractTime(text: string): { time: string; rest: string } | null {
  for (const rule of TIME_RULES) {
    const m = text.match(rule.re);
    if (!m) continue;
    const { h, mi, mer, minutes } = rule.read(m);
    const hour = to24h(h, mer, minutes);
    if (hour === null || mi > 59) continue;
    return { time: `${pad(hour)}:${pad(mi)}`, rest: text.replace(m[0], " ") };
  }
  return null;
}

// ─── Repetition ──────────────────────────────────────────────────────────────

const WEEKDAYS_EN = "sunday|monday|tuesday|wednesday|thursday|friday|saturday";
// With or without the article: "الخميس" and the dialect "خميس" ("كل يوم خميس").
const WEEKDAYS_AR = "(?:ال)?(?:أحد|احد|اثنين|إثنين|أثنين|اتنين|ثلاثاء|ثلثاء|أربعاء|اربعاء|خميس|جمعة|جمعه|سبت)";

const REPEAT_RULES: { re: RegExp; repeat: Repeat }[] = [
  { re: word("weekdays|every\\s+weekday"), repeat: "mon-fri" },
  { re: word("كل\\s+يوم\\s+عمل|أيام\\s+العمل|ايام\\s+العمل"), repeat: "sun-thu" },
  { re: word("every\\s+week|weekly|كل\\s+(?:أسبوع|اسبوع)|أسبوعيا|اسبوعيا"), repeat: "weekly" },
  { re: word("every\\s+month|monthly|كل\\s+شهر|شهريا"), repeat: "monthly" },
  { re: word("every\\s+day|daily|كل\\s+يوم|يوميا"), repeat: "daily" },
];

/** "every monday" / "كل يوم خميس" → weekly, keeping the weekday so the date rule anchors it. */
export function extractRepeat(text: string): { repeat: Repeat; rest: string } | null {
  const en = text.match(new RegExp(`${NOT_BEFORE}every\\s+(${WEEKDAYS_EN})${NOT_AFTER}`, "iu"));
  if (en) return { repeat: "weekly", rest: text.replace(en[0], en[1]) };
  const ar = text.match(new RegExp(`${NOT_BEFORE}كل\\s+(?:يوم\\s+)?(${WEEKDAYS_AR})${NOT_AFTER}`, "u"));
  if (ar) return { repeat: "weekly", rest: text.replace(ar[0], ar[1].startsWith("ال") ? ar[1] : `ال${ar[1]}`) };
  for (const rule of REPEAT_RULES) {
    const m = text.match(rule.re);
    if (m) return { repeat: rule.repeat, rest: text.replace(m[0], " ") };
  }
  return null;
}

const MARKER_DONE = /^\s*(?:\[[xX]\]|[☑☒✅✔✓])/;
const MARKER_LEAD = /^\s*(?:(?:[•▪◦·‣⁃☐□○]\s*|[-*]\s+|\[\s?\]\s*|\d+[.)]\s+))+/;

/** Parses one line of text. Returns null for empty lines and already-checked checklist items. */
export function parseTaskLine(line: string, now: Date = new Date()): ParsedTask | null {
  if (MARKER_DONE.test(line)) return null;
  const original = line.replace(MARKER_LEAD, "").trim();
  if (!original) return null;

  let text = original;
  let priority: Priority | undefined;
  let category: Category | undefined;

  text = text.replace(/#([\p{L}\p{N}_]+)/gu, (m, w: string) => {
    const c = CATEGORIES[w.toLowerCase()];
    if (!c) return m;
    category = c;
    return " ";
  });
  text = text.replace(/!([\p{L}\p{N}_]+)/gu, (m, w: string) => {
    const p = PRIORITIES[w.toLowerCase()];
    if (!p) return m;
    priority = p;
    return " ";
  });

  const rep = extractRepeat(text);
  if (rep) text = rep.rest;
  const clock = extractTime(text);
  if (clock) text = clock.rest;
  const found = extractDate(text, now);
  if (found) text = found.rest;

  const title = text.replace(/\s{2,}/g, " ").replace(/^[\s,.;:،؛-]+|[\s,.;:،؛-]+$/g, "");
  if (!title) return { title: original.slice(0, MAX_TITLE) };

  const result: ParsedTask = { title: title.slice(0, MAX_TITLE) };
  if (priority) result.priority = priority;
  if (category) result.category = category;
  if (found) result.due_date = found.date;
  if (clock) result.time = clock.time;
  if (rep) result.repeat = rep.repeat;
  return result;
}

/** One task per non-empty line; list markers ("- [ ]", "•", "1.") are stripped. */
export function parseTasksFromText(text: string, now: Date = new Date()): ParsedTask[] {
  const out: ParsedTask[] = [];
  for (const line of text.split(/\r?\n/)) {
    const parsed = parseTaskLine(line, now);
    if (parsed) out.push(parsed);
    if (out.length >= MAX_TASKS_PER_BATCH) break;
  }
  return out;
}

export function parsePriority(value: string | null | undefined): Priority | undefined {
  return value ? PRIORITIES[value.trim().toLowerCase()] : undefined;
}

export function parseCategory(value: string | null | undefined): Category | undefined {
  return value ? CATEGORIES[value.trim().toLowerCase()] : undefined;
}

/** Accepts yyyy-MM-dd or a date phrase such as "tomorrow" / "بكرة". */
export function parseDueParam(value: string | null | undefined, now: Date = new Date()): string | undefined {
  return value ? extractDate(value.trim(), now)?.date : undefined;
}
