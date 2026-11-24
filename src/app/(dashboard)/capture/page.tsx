"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Apple, Bookmark, Check, ClipboardList, Copy, Mic, Send, Sparkles, Zap } from "lucide-react";
import toast from "react-hot-toast";
import { ImportTasksModal } from "@/components/capture/ImportTasksModal";
import { useT, tr } from "@/lib/i18n";

/** Renders **bold**, __italic__ and `code` markers inside a translated string. */
function Rich({ text }: { text: string }) {
  const parts = text.split(/(\*\*.+?\*\*|__.+?__|`.+?`)/g);
  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith("**") && p.endsWith("**") && p.length > 4) return <strong key={i}>{p.slice(2, -2)}</strong>;
        if (p.startsWith("__") && p.endsWith("__") && p.length > 4) return <em key={i}>{p.slice(2, -2)}</em>;
        if (p.startsWith("`") && p.endsWith("`") && p.length > 2)
          return <code key={i} className="bg-secondary px-1 rounded" dir="auto">{p.slice(1, -1)}</code>;
        return <span key={i}>{p}</span>;
      })}
    </>
  );
}

const noopSubscribe = () => () => {};

/** Absolute URL of the app root, whatever the base path / host is. Empty during SSR. */
function useAppBase(): string {
  return useSyncExternalStore(
    noopSubscribe,
    () => `${window.location.origin}${window.location.pathname.replace(/capture\/?$/, "")}`,
    () => "",
  );
}

function CopyBlock({ label, value }: { label: string; value: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error(t("Couldn't copy — select the text and copy it manually"));
    }
  }

  return (
    <div>
      <p className="text-xs font-medium text-secondary-fg mb-1">{label}</p>
      <div className="flex items-stretch gap-2">
        <code className="flex-1 min-w-0 bg-secondary rounded-lg px-3 py-2 text-xs text-base-fg break-all select-all" dir="ltr">
          {value || "…"}
        </code>
        <button onClick={copy} disabled={!value} className="btn-secondary px-3" aria-label={t("Copy {label}", { label })}>
          {copied ? <Check className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}

function Section({ icon: Icon, title, children }: { icon: typeof Zap; title: string; children: React.ReactNode }) {
  return (
    <section className="card p-5 space-y-3">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center">
          <Icon className="w-4 h-4 text-primary" />
        </div>
        <h2 className="font-semibold text-base-fg">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function Steps({ items }: { items: React.ReactNode[] }) {
  return (
    <ol className="space-y-2 text-sm text-secondary-fg list-decimal ps-5">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ol>
  );
}

export default function CapturePage() {
  const t = useT();
  const base = useAppBase();
  const [showImport, setShowImport] = useState(false);
  const captureLink = base ? `${base}dashboard/?add=` : "";
  const bookmarklet = base
    ? `javascript:(()=>{const t=prompt("${tr("Add to TaskFlow")}");if(t)window.open("${base}dashboard/?add="+encodeURIComponent(t))})()`
    : "";
  const sampleLink = base ? `${base}dashboard/?add=${encodeURIComponent("Try TaskFlow capture tomorrow #personal !low")}` : "#";

  return (
    <div className="max-w-2xl mx-auto space-y-5 pb-24 md:pb-8">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 bg-secondary rounded-xl flex items-center justify-center">
          <Zap className="w-5 h-5 text-secondary-fg" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-base-fg">{t("Add tasks from anywhere")}</h1>
          <p className="text-sm text-secondary-fg">{t("Capture from your phone, notes, voice or chat — it all lands in your list.")}</p>
        </div>
      </div>

      <Section icon={Sparkles} title={t("Your capture link")}>
        <CopyBlock label={t("Add this to any link, shortcut or bookmark")} value={captureLink} />
        <p className="text-sm text-secondary-fg">
          <Rich text={t("Put the task text right after `?add=`. Several lines make several tasks.")} />{" "}
          {t("Extras:")} <code className="bg-secondary px-1 rounded">&amp;priority=high</code>{" "}
          <code className="bg-secondary px-1 rounded">&amp;due=tomorrow</code>{" "}
          <code className="bg-secondary px-1 rounded">&amp;category=work</code>{" "}
          <code className="bg-secondary px-1 rounded">&amp;notes=…</code>
        </p>
        <a href={sampleLink} className="btn-secondary inline-flex text-xs">{t("Try it with a sample task")}</a>
      </Section>

      <Section icon={Apple} title={t("Apple Shortcuts — iPhone, iPad, Mac")}>
        <Steps
          items={[
            <Rich key={126} text={t("Open **Shortcuts** → **+** and name it “Add to TaskFlow”.")} />,
            <Rich key={127} text={t("Add **Ask for Input** (type Text). For voice, use **Dictate Text** instead — Arabic works too.")} />,
            <Rich key={128} text={t("Add a **Text** action: paste the capture link above, then insert the **Provided Input** variable right after it.")} />,
            <Rich key={129} text={t("Add **Open URLs** and pass it that Text. If spaces or Arabic letters don't come through, run the Text through **URL Encode** first.")} />,
            <Rich key={130} text={t("Open the shortcut's settings and turn on **Show in Share Sheet** to send selected text from Notes, Safari or Messages straight to TaskFlow.")} />,
            <Rich key={131} text={t("Say **“Hey Siri, Add to TaskFlow”**, add it to your Home Screen, or map it to the Action Button / Back Tap.")} />,
          ]}
        />
        <p className="text-xs leading-relaxed rounded-lg border border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300 p-3">
          <Rich text={t("Heads-up: Shortcuts opens the link in Safari. On iPhone a site added to the Home Screen __as an app__ keeps separate storage from Safari, so use TaskFlow in Safari (or add it to the Home Screen with “Open as Web App” off).")} />
        </p>
      </Section>

      <Section icon={ClipboardList} title={t("Apple Notes (and Reminders)")}>
        <Steps
          items={[
            <Rich key={142} text={t("In Notes, select your checklist or bullet list and tap **Copy**.")} />,
            <Rich key={143} text={t("Come back here (or the Dashboard) and press **Import** — or just paste into Quick Add.")} />,
            <Rich key={144} text={t("Review the preview and tap **Add**. Bullets, numbers and checkboxes are cleaned up; items already checked off are skipped.")} />,
          ]}
        />
        <button onClick={() => setShowImport(true)} className="btn-primary text-sm">
          <ClipboardList className="w-4 h-4" /> {t("Paste a list now")}
        </button>
        <p className="text-sm text-secondary-fg">
          <Rich text={t("Want it automatic? In Shortcuts use **Find Notes** → **Get Details of Notes** (Body) and pass the result to the same **Text → Open URLs** steps above — each line becomes a task.")} />
        </p>
      </Section>

      <Section icon={Send} title={t("Telegram")}>
        <p className="text-sm text-secondary-fg">
          {t("Message your own bot from any device and the text becomes a task. Set it up once in")}{" "}
          <Link href="/settings" className="text-primary font-medium hover:underline">{t("Settings → Telegram")}</Link>.
        </p>
      </Section>

      <Section icon={Bookmark} title={t("Browser bookmarklet (desktop)")}>
        <Steps
          items={[
            t("Create a new bookmark in your browser (any page)."),
            t("Edit it: name “Add to TaskFlow”, and paste the code below as the URL."),
            t("Click it on any page, type the task, and TaskFlow opens with it added."),
          ]}
        />
        <CopyBlock label={t("Bookmarklet")} value={bookmarklet} />
      </Section>

      <Section icon={Mic} title={t("What you can write")}>
        <ul className="text-sm text-secondary-fg space-y-1.5">
          <li><Rich text={t("**Dates:** today, tomorrow, Friday, next week, in 3 days, 2026-12-31 — or اليوم، بكرة، بعد غد، الخميس، الأسبوع القادم")} /></li>
          <li><Rich text={t("**Priority:** `!urgent` `!high` `!low` — or `!عاجل !مهم`")} /></li>
          <li><Rich text={t("**Time (makes a reminder):** at 5pm, 17:30, 9 am — or الساعة 5 مساء، الساعة 8 صباحا")} /></li>
          <li><Rich text={t("**Repeat:** every day, weekly, monthly, weekdays, every monday — or كل يوم، أسبوعيا، شهريا، كل يوم خميس")} /></li>
          <li><Rich text={t("**Category:** `#work` `#health` … or `#عمل #صحة #شخصي`")} /></li>
          <li><strong>{t("Examples:")}</strong> <span dir="auto">Pay the invoice Thursday !high #finance</span> · <span dir="auto">اتصل بأمي غدا الساعة 5 مساء</span> · <span dir="auto">Take pills every day at 8am</span></li>
        </ul>
      </Section>

      {showImport && <ImportTasksModal onClose={() => setShowImport(false)} />}
    </div>
  );
}
