"use client";

import { setLang, useLang } from "@/lib/i18n";

/** One-tap EN ⇄ العربية switch for the header (the full selector is in Settings). */
export function LanguageToggle({ className = "" }: { className?: string }) {
  const lang = useLang();
  const next = lang === "ar" ? "en" : "ar";
  return (
    <button
      type="button"
      onClick={() => setLang(next)}
      className={`min-w-11 h-11 md:min-w-9 md:h-9 px-2 rounded-xl flex items-center justify-center text-sm font-semibold text-secondary-fg hover:bg-secondary hover:text-base-fg transition-all ${className}`}
      aria-label={lang === "ar" ? "Switch to English" : "التبديل إلى العربية"}
      lang={next}
    >
      {lang === "ar" ? "EN" : "عربي"}
    </button>
  );
}
