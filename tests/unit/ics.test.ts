import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCalendar, escapeText, fold, eventLines } from "../../telegram-bot/lib/ics.ts";
import { zonedToEpoch } from "../../telegram-bot/lib/recurrence.ts";

const NOW = Date.UTC(2026, 10, 16, 8, 0, 0);
const RIYADH = "Asia/Riyadh";

const unfold = (ics: string) => ics.replace(/\r\n /g, "");

test("escapes the characters iCalendar treats specially", () => {
  assert.equal(escapeText("a,b;c\\d\nnext"), "a\\,b\\;c\\\\d\\nnext");
});

test("folds long lines at 75 octets and never splits a multi-byte character", () => {
  const long = "SUMMARY:" + "مهمة طويلة جداً ".repeat(20);
  const folded = fold(long);
  const physical = folded.split("\r\n");
  assert.ok(physical.length > 1);
  for (const line of physical) assert.ok(new TextEncoder().encode(line).length <= 75, `line too long: ${line.length}`);
  assert.equal(folded.replace(/\r\n /g, ""), long); // lossless
});

test("a one-off reminder is a UTC event with an alarm at start", () => {
  const at = zonedToEpoch(2026, 11, 17, 17, 0, RIYADH);
  const ics = unfold(buildCalendar([{ id: "t1", title: "Call, mom", reminder_at: at, tz: RIYADH, priority: "high", category: "personal" }], NOW));
  assert.match(ics, /^BEGIN:VCALENDAR\r\nVERSION:2\.0\r\n/);
  assert.match(ics, /UID:t1@taskflow/);
  assert.match(ics, /SUMMARY:Call\\, mom/);
  assert.match(ics, /DTSTART:20261117T140000Z/);
  assert.match(ics, /DTEND:20261117T143000Z/);
  assert.match(ics, /PRIORITY:3/);
  assert.match(ics, /BEGIN:VALARM\r\nACTION:DISPLAY[\s\S]*TRIGGER:PT0S\r\nEND:VALARM/);
  assert.ok(!/RRULE/.test(ics));
  assert.match(ics, /\r\nEND:VCALENDAR\r\n$/);
});

test("a repeating reminder uses floating local time plus an RRULE (survives DST)", () => {
  const at = zonedToEpoch(2026, 11, 17, 17, 0, RIYADH);
  const out = (repeat: "daily" | "mon-fri" | "sun-thu" | "weekly" | "monthly") =>
    unfold(eventLines({ id: "r", title: "Pills", reminder_at: at, tz: RIYADH, repeat }, NOW)!.join("\r\n"));
  assert.match(out("daily"), /DTSTART:20261117T170000\r\n/);
  assert.match(out("daily"), /RRULE:FREQ=DAILY/);
  assert.match(out("sun-thu"), /RRULE:FREQ=WEEKLY;BYDAY=SU,MO,TU,WE,TH/);
  assert.match(out("mon-fri"), /RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR/);
  assert.match(out("weekly"), /RRULE:FREQ=WEEKLY\r\n/);
  assert.match(out("monthly"), /RRULE:FREQ=MONTHLY/);
});

test("a task with only a due date is a free all-day event with a 09:00 alarm", () => {
  const ics = buildCalendar([{ id: "d1", title: "Pay rent", due_date: "2026-11-30", description: "Bank transfer" }], NOW);
  assert.match(ics, /DTSTART;VALUE=DATE:20261130/);
  assert.match(ics, /DTEND;VALUE=DATE:20261201/);
  assert.match(ics, /TRANSP:TRANSPARENT/);
  assert.match(ics, /TRIGGER:PT9H/);
  assert.match(unfold(ics), /DESCRIPTION:Bank transfer\\nDue: 2026-11-30/);
});

test("month and year rollover for all-day events", () => {
  assert.match(buildCalendar([{ id: "y", title: "NYE", due_date: "2026-12-31" }], NOW), /DTEND;VALUE=DATE:20270101/);
});

test("items without a date are skipped; alarms can be turned off", () => {
  const ics = buildCalendar([{ id: "n", title: "No date" }, { id: "a", title: "Quiet", due_date: "2026-11-30", alarm: false }], NOW);
  assert.ok(!/No date/.test(ics));
  assert.ok(!/VALARM/.test(ics));
  assert.match(ics, /Quiet/);
});

test("every physical line ends with CRLF and the calendar advertises an hourly refresh", () => {
  const ics = buildCalendar([{ id: "a", title: "x", due_date: "2026-11-30" }], NOW);
  assert.ok(ics.split("\r\n").slice(0, -1).every((l) => !l.includes("\n")));
  assert.match(ics, /X-PUBLISHED-TTL:PT1H/);
});
