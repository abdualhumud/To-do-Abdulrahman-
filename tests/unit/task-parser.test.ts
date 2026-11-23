import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatLocalDate,
  parseCategory,
  parseDueParam,
  parsePriority,
  parseTaskLine,
  parseTasksFromText,
  MAX_TASKS_PER_BATCH,
} from "../../src/lib/task-parser.ts";

// Monday, 16 Nov 2026 (local time)
const now = new Date(2026, 10, 16, 10, 0, 0);

const cases: [string, Record<string, string>][] = [
  ["Buy groceries tomorrow #personal !high", { title: "Buy groceries", due_date: "2026-11-17", category: "personal", priority: "high" }],
  ["اشتري حليب بكرة #صحة !مهم", { title: "اشتري حليب", due_date: "2026-11-17", category: "health", priority: "high" }],
  ["Call mom on Friday", { title: "Call mom", due_date: "2026-11-20" }],
  ["اجتماع يوم الخميس !عاجل", { title: "اجتماع", due_date: "2026-11-19", priority: "urgent" }],
  ["Submit report by monday", { title: "Submit report", due_date: "2026-11-23" }],
  ["Pay rent in 3 days", { title: "Pay rent", due_date: "2026-11-19" }],
  ["سداد الفاتورة بعد ٣ أيام", { title: "سداد الفاتورة", due_date: "2026-11-19" }],
  ["Dentist 2026-12-05 #health", { title: "Dentist", due_date: "2026-12-05", category: "health" }],
  ["- [ ] Write tests today", { title: "Write tests", due_date: "2026-11-16" }],
  ["• اتصل بالمدير غدا", { title: "اتصل بالمدير", due_date: "2026-11-17" }],
  ["1) Read book next week", { title: "Read book", due_date: "2026-11-23" }],
  ["tomorrow", { title: "tomorrow" }],
  ["Fix bug #123", { title: "Fix bug #123" }],
  ["Meeting at 5pm tomorrow", { title: "Meeting at 5pm", due_date: "2026-11-17" }],
  ["Saturday night party", { title: "night party", due_date: "2026-11-21" }],
  ["Visit the dayton office", { title: "Visit the dayton office" }],
  ["بعد غد موعد الطبيب", { title: "موعد الطبيب", due_date: "2026-11-18" }],
  ["Not a date: 2026-02-31", { title: "Not a date: 2026-02-31" }],
];

for (const [input, expected] of cases) {
  test(`parses ${JSON.stringify(input)}`, () => {
    assert.deepStrictEqual(parseTaskLine(input, now), expected);
  });
}

test("empty and already-checked lines are skipped", () => {
  assert.equal(parseTaskLine("   ", now), null);
  assert.equal(parseTaskLine("☑ done thing", now), null);
  assert.equal(parseTaskLine("[x] done", now), null);
  assert.equal(parseTaskLine("✅ done", now), null);
});

test("multi-line text becomes one task per line", () => {
  const titles = parseTasksFromText("Milk\n\n- [ ] Eggs tomorrow\n✅ done\n3. Bread", now).map((t) => t.title);
  assert.deepEqual(titles, ["Milk", "Eggs", "Bread"]);
});

test("a batch is capped", () => {
  const text = Array.from({ length: MAX_TASKS_PER_BATCH + 20 }, (_, i) => `task ${i}`).join("\n");
  assert.equal(parseTasksFromText(text, now).length, MAX_TASKS_PER_BATCH);
});

test("titles are capped at 500 characters", () => {
  assert.equal(parseTaskLine("x".repeat(2000), now)?.title.length, 500);
});

test("link parameters: due, priority and category accept words in both languages", () => {
  assert.equal(parseDueParam("tomorrow", now), "2026-11-17");
  assert.equal(parseDueParam("2026-12-31", now), "2026-12-31");
  assert.equal(parseDueParam("garbage", now), undefined);
  assert.equal(parsePriority("URGENT"), "urgent");
  assert.equal(parsePriority("عاجل"), "urgent");
  assert.equal(parseCategory("عمل"), "work");
  assert.equal(parseCategory("nope"), undefined);
});

test("dates are local calendar days, never UTC", () => {
  // 00:30 local: the UTC date can differ (e.g. UTC+3) but the local day must win.
  assert.equal(formatLocalDate(new Date(2026, 10, 17, 0, 30)), "2026-11-17");
  assert.equal(formatLocalDate(new Date(2026, 10, 17, 23, 59)), "2026-11-17");
});
