import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GRACE_MS,
  formatZoned,
  isValidTimeZone,
  nextFire,
  occurrenceAfter,
  zonedParts,
  zonedToEpoch,
} from "../../telegram-bot/lib/recurrence.ts";

const RIYADH = "Asia/Riyadh"; // UTC+3, no DST
const NY = "America/New_York"; // DST: starts 8 Mar 2026, ends 1 Nov 2026
const at = (y: number, m: number, d: number, h: number, mi: number, tz: string) => zonedToEpoch(y, m, d, h, mi, tz);

test("zonedToEpoch / zonedParts round-trip", () => {
  const t = at(2026, 11, 17, 17, 0, RIYADH);
  assert.equal(t, Date.UTC(2026, 10, 17, 14, 0));
  const p = zonedParts(t, RIYADH);
  assert.deepEqual([p.y, p.m, p.d, p.h, p.mi], [2026, 11, 17, 17, 0]);
  assert.equal(p.weekday, 2); // Tuesday
  // midnight must be hour 0, not 24
  assert.equal(zonedParts(at(2026, 11, 17, 0, 0, RIYADH), RIYADH).h, 0);
});

test("the same wall-clock time maps to different instants across a DST change", () => {
  const before = at(2026, 3, 7, 9, 0, NY); // EST (UTC-5)
  const after = at(2026, 3, 9, 9, 0, NY); // EDT (UTC-4)
  assert.equal(before, Date.UTC(2026, 2, 7, 14, 0));
  assert.equal(after, Date.UTC(2026, 2, 9, 13, 0));
});

test("daily reminders keep their wall-clock time over a DST change", () => {
  const anchor = at(2026, 3, 7, 9, 0, NY);
  const day3 = occurrenceAfter(anchor, "daily", NY, at(2026, 3, 8, 12, 0, NY))!;
  assert.deepEqual([zonedParts(day3, NY).d, zonedParts(day3, NY).h], [9, 9]);
  assert.equal(day3, Date.UTC(2026, 2, 9, 13, 0));
});

test("a nonexistent local time (spring-forward gap) still resolves to a real instant", () => {
  const t = at(2026, 3, 8, 2, 30, NY); // 02:30 does not exist on 8 Mar 2026
  assert.ok(Number.isFinite(t));
  assert.equal(zonedParts(t, NY).d, 8);
});

test("none: fires once, only in the future", () => {
  const anchor = at(2026, 11, 17, 17, 0, RIYADH);
  assert.equal(occurrenceAfter(anchor, "none", RIYADH, anchor - 1), anchor);
  assert.equal(occurrenceAfter(anchor, "none", RIYADH, anchor), null);
});

test("daily / weekly / monthly", () => {
  const anchor = at(2026, 11, 17, 17, 0, RIYADH); // Tuesday
  assert.equal(occurrenceAfter(anchor, "daily", RIYADH, anchor), at(2026, 11, 18, 17, 0, RIYADH));
  assert.equal(occurrenceAfter(anchor, "weekly", RIYADH, anchor), at(2026, 11, 24, 17, 0, RIYADH));
  assert.equal(occurrenceAfter(anchor, "weekly", RIYADH, at(2026, 12, 1, 17, 0, RIYADH)), at(2026, 12, 8, 17, 0, RIYADH));
  assert.equal(occurrenceAfter(anchor, "monthly", RIYADH, anchor), at(2026, 12, 17, 17, 0, RIYADH));
});

test("monthly on the 31st clamps to the end of shorter months, then returns to the 31st", () => {
  const anchor = at(2027, 1, 31, 8, 0, RIYADH);
  const feb = occurrenceAfter(anchor, "monthly", RIYADH, anchor)!;
  assert.deepEqual([zonedParts(feb, RIYADH).m, zonedParts(feb, RIYADH).d], [2, 28]);
  const mar = occurrenceAfter(anchor, "monthly", RIYADH, feb)!;
  assert.deepEqual([zonedParts(mar, RIYADH).m, zonedParts(mar, RIYADH).d], [3, 31]);
  const leap = occurrenceAfter(at(2028, 1, 31, 8, 0, RIYADH), "monthly", RIYADH, at(2028, 1, 31, 8, 0, RIYADH))!;
  assert.equal(zonedParts(leap, RIYADH).d, 29);
});

test("Mon–Fri skips the weekend; Sun–Thu (Saudi work week) skips Friday and Saturday", () => {
  const thu = at(2026, 11, 19, 9, 0, RIYADH);
  const fri = at(2026, 11, 20, 9, 0, RIYADH);
  assert.equal(zonedParts(occurrenceAfter(thu, "mon-fri", RIYADH, thu)!, RIYADH).weekday, 5); // Fri
  assert.equal(zonedParts(occurrenceAfter(fri, "mon-fri", RIYADH, fri)!, RIYADH).weekday, 1); // Mon
  assert.equal(zonedParts(occurrenceAfter(thu, "sun-thu", RIYADH, thu)!, RIYADH).weekday, 0); // Sun
  const sun = occurrenceAfter(thu, "sun-thu", RIYADH, thu)!;
  assert.equal(zonedParts(occurrenceAfter(sun, "sun-thu", RIYADH, sun)!, RIYADH).weekday, 1); // Mon
});

test("an anchor on a non-working day first fires on the next working day", () => {
  const sat = at(2026, 11, 21, 9, 0, RIYADH);
  assert.equal(zonedParts(occurrenceAfter(sat, "mon-fri", RIYADH, sat - 1)!, RIYADH).weekday, 1);
});

test("nextFire: one-off fires once; late but within grace is still sent; too stale is dropped", () => {
  const anchor = at(2026, 11, 17, 17, 0, RIYADH);
  const spec = { anchor, repeat: "none" as const, tz: RIYADH };
  assert.equal(nextFire(spec, null, anchor - 60_000), anchor);
  assert.equal(nextFire(spec, null, anchor + 20 * 60_000), anchor); // 20 min late
  assert.equal(nextFire(spec, null, anchor + GRACE_MS + 60_000), null); // far too late
  assert.equal(nextFire(spec, anchor, anchor + 1000), null); // already delivered
  const moved = { ...spec, anchor: anchor + DAY };
  assert.equal(nextFire(moved, anchor, anchor + 1000), anchor + DAY); // edited after delivery → fires again
});
const DAY = 86_400_000;

test("nextFire: repeating reminders never flood after downtime", () => {
  const anchor = at(2026, 11, 1, 9, 0, RIYADH);
  const spec = { anchor, repeat: "daily" as const, tz: RIYADH };
  const now = at(2026, 11, 20, 9, 30, RIYADH); // server was down for 19 days
  assert.equal(nextFire(spec, anchor, now), at(2026, 11, 20, 9, 0, RIYADH)); // only the one within grace
  assert.equal(nextFire(spec, at(2026, 11, 20, 9, 0, RIYADH), now), at(2026, 11, 21, 9, 0, RIYADH));
});

test("time zone helpers", () => {
  assert.equal(isValidTimeZone("Asia/Riyadh"), true);
  assert.equal(isValidTimeZone("Not/AZone"), false);
  assert.match(formatZoned(at(2026, 11, 17, 17, 0, RIYADH), RIYADH), /17 Nov 2026/);
});
