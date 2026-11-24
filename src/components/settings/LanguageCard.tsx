"use client";

import { Languages } from "lucide-react";
import { setLang, useLang, useT, type Lang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const OPTIONS: { value: Lang; label: string }[] = [
  { value: "en", label: "English" },
  { value: "ar", label: "العربية" },
];

export function LanguageCard() {
  const lang = useLang();
  const t = useT();
  return (
    <div className="card p-5 space-y-3">
      <div className="flex items-center gap-2">
        <Languages className="w-4 h-4 text-secondary-fg" />
        <h2 className="font-semibold text-base-fg">{t("Language")}</h2>
      </div>
      <p className="text-sm text-secondary-fg">{t("Choose the language of the app. Dates and layout follow it.")}</p>
      <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label={t("Language")}>
        {OPTIONS.map((o) => (
          <button
            key={o.value}
            role="radio"
            aria-checked={lang === o.value}
            onClick={() => setLang(o.value)}
            lang={o.value}
            className={cn(
              "min-h-12 rounded-xl border-2 text-base font-medium transition-all",
              lang === o.value ? "border-primary bg-accent text-primary" : "border-base text-secondary-fg hover:border-primary",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
