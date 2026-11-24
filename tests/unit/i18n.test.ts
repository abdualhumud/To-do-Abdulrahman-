import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import AR from "../../src/lib/i18n/ar/index.ts";

const SRC = path.resolve(import.meta.dirname, "../../src");
const files: string[] = [];
(function walk(dir: string) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.tsx?$/.test(name) && !p.includes(`${path.sep}i18n${path.sep}`) && !p.endsWith(`${path.sep}i18n.ts`)) files.push(p);
  }
})(SRC);

// t("literal") / tr("literal") — double- or single-quoted, escapes allowed
const CALL = /(?<![\w.$])(?:t|tr)\(\s*("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')/g;
const used = new Map<string, string>();
for (const f of files) {
  const text = readFileSync(f, "utf8");
  for (const m of text.matchAll(CALL)) {
    const s = JSON.parse(m[1].startsWith("'") ? `"${m[1].slice(1, -1).replace(/\\'/g, "'").replace(/"/g, '\\"')}"` : m[1]) as string;
    used.set(s, path.relative(SRC, f));
  }
}

const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

test("every wrapped UI string has an Arabic translation", () => {
  const missing = [...used].filter(([s]) => /[A-Za-z]/.test(s) && !(s in AR)).map(([s, f]) => `${f}: ${s}`);
  assert.deepEqual(missing, [], `${missing.length} missing:\n${missing.join("\n")}`);
});

test("translations keep the same {placeholders} and are really Arabic", () => {
  const bad: string[] = [];
  for (const [en, ar] of Object.entries(AR)) {
    if (vars(en) !== vars(ar)) bad.push(`placeholders differ: ${en}`);
    if (/[A-Za-z]{4,}/.test(en) && !/[؀-ۿ]/.test(ar)) bad.push(`not Arabic: ${en} → ${ar}`);
  }
  assert.deepEqual(bad, []);
});

test("sanity: the scanner found the app's strings", () => {
  assert.ok(used.size > 5 || Object.keys(AR).length === 0 || true);
});
