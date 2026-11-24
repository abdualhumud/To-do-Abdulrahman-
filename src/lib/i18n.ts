"use client";

/**
 * Tiny i18n. UI strings are written in English in the code and wrapped: `t("Delete this task?")`.
 * Arabic lives in src/lib/i18n/ar/*.ts keyed by the exact English string; a missing key falls back to
 * English (and tests/unit/i18n.test.ts fails the build if a wrapped string has no Arabic entry).
 * Variables use {name}: t("Added {n} tasks", { n: 3 }).
 */

import { useSyncExternalStore } from "react";
import { format as dfFormat } from "date-fns";
import { ar as dfAr } from "date-fns/locale";
import AR from "@/lib/i18n/ar";

export type Lang = "en" | "ar";
const KEY = "tf_lang"; // not sensitive → plain localStorage so it can be read before hydration

function detect(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "ar" || saved === "en") return saved;
  } catch {
    /* blocked storage */
  }
  return typeof navigator !== "undefined" && /^ar\b/i.test(navigator.language) ? "ar" : "en";
}

let current: Lang = typeof window === "undefined" ? "en" : detect();
const listeners = new Set<() => void>();

export function applyDocumentLang(lang: Lang): void {
  if (typeof document === "undefined") return;
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
}
if (typeof window !== "undefined") applyDocumentLang(current);

export const getLang = (): Lang => current;

export function setLang(lang: Lang): void {
  current = lang;
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    /* ignore */
  }
  applyDocumentLang(lang);
  listeners.forEach((cb) => cb());
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

export function useLang(): Lang {
  return useSyncExternalStore(subscribe, getLang, () => "en" as Lang);
}

type Vars = Record<string, string | number>;

function interpolate(text: string, vars?: Vars): string {
  return vars ? text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : text;
}

/** Translate outside React (toasts and errors raised in lib code). */
export function tr(en: string, vars?: Vars, lang: Lang = current): string {
  return interpolate(lang === "ar" ? (AR[en] ?? en) : en, vars);
}

/** Translate inside components; re-renders when the language changes. */
export function useT(): (en: string, vars?: Vars) => string {
  const lang = useLang();
  return (en, vars) => tr(en, vars, lang);
}

// ─── Dates (Gregorian in both languages, Latin digits so they match what people type) ──────────

export const dateLocale = (lang: Lang = current): string => (lang === "ar" ? "ar-u-ca-gregory-nu-latn" : "en-US");

export function fmtDate(d: Date, opts: Intl.DateTimeFormatOptions, lang: Lang = current): string {
  return d.toLocaleDateString(dateLocale(lang), opts);
}
export function fmtDateTime(d: Date, opts: Intl.DateTimeFormatOptions, lang: Lang = current): string {
  return d.toLocaleString(lang === "ar" ? dateLocale(lang) : "en-GB", opts);
}
export const fmtTime = (d: Date, lang: Lang = current): string => d.toLocaleTimeString(dateLocale(lang));

/** date-fns format() in the current language, e.g. fmtPattern(d, "EEE"). */
export function fmtPattern(d: Date, pattern: string, lang: Lang = current): string {
  return dfFormat(d, pattern, lang === "ar" ? { locale: dfAr } : undefined);
}
