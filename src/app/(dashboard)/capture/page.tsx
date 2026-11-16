"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Apple, Bookmark, Check, ClipboardList, Copy, Mic, Send, Sparkles, Zap } from "lucide-react";
import toast from "react-hot-toast";
import { ImportTasksModal } from "@/components/capture/ImportTasksModal";

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
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy — select the text and copy it manually");
    }
  }

  return (
    <div>
      <p className="text-xs font-medium text-secondary-fg mb-1">{label}</p>
      <div className="flex items-stretch gap-2">
        <code className="flex-1 min-w-0 bg-secondary rounded-lg px-3 py-2 text-xs text-base-fg break-all select-all" dir="ltr">
          {value || "…"}
        </code>
        <button onClick={copy} disabled={!value} className="btn-secondary px-3" aria-label={`Copy ${label}`}>
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
    <ol className="space-y-2 text-sm text-secondary-fg list-decimal pl-5">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ol>
  );
}

export default function CapturePage() {
  const base = useAppBase();
  const [showImport, setShowImport] = useState(false);
  const captureLink = base ? `${base}dashboard/?add=` : "";
  const bookmarklet = base
    ? `javascript:(()=>{const t=prompt("Add to TaskFlow");if(t)window.open("${base}dashboard/?add="+encodeURIComponent(t))})()`
    : "";
  const sampleLink = base ? `${base}dashboard/?add=${encodeURIComponent("Try TaskFlow capture tomorrow #personal !low")}` : "#";

  return (
    <div className="max-w-2xl mx-auto space-y-5 pb-24 md:pb-8">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 bg-secondary rounded-xl flex items-center justify-center">
          <Zap className="w-5 h-5 text-secondary-fg" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-base-fg">Add tasks from anywhere</h1>
          <p className="text-sm text-secondary-fg">Capture from your phone, notes, voice or chat — it all lands in your list.</p>
        </div>
      </div>

      <Section icon={Sparkles} title="Your capture link">
        <CopyBlock label="Add this to any link, shortcut or bookmark" value={captureLink} />
        <p className="text-sm text-secondary-fg">
          Put the task text right after <code className="bg-secondary px-1 rounded">?add=</code>. Several lines make several tasks.
          Extras: <code className="bg-secondary px-1 rounded">&amp;priority=high</code>{" "}
          <code className="bg-secondary px-1 rounded">&amp;due=tomorrow</code>{" "}
          <code className="bg-secondary px-1 rounded">&amp;category=work</code>{" "}
          <code className="bg-secondary px-1 rounded">&amp;notes=…</code>
        </p>
        <a href={sampleLink} className="btn-secondary inline-flex text-xs">Try it with a sample task</a>
      </Section>

      <Section icon={Apple} title="Apple Shortcuts — iPhone, iPad, Mac">
        <Steps
          items={[
            <>Open <strong>Shortcuts</strong> → <strong>+</strong> and name it “Add to TaskFlow”.</>,
            <>Add <strong>Ask for Input</strong> (type Text). For voice, use <strong>Dictate Text</strong> instead — Arabic works too.</>,
            <>Add a <strong>Text</strong> action: paste the capture link above, then insert the <strong>Provided Input</strong> variable right after it.</>,
            <>Add <strong>Open URLs</strong> and pass it that Text. If spaces or Arabic letters don&apos;t come through, run the Text through <strong>URL Encode</strong> first.</>,
            <>Open the shortcut&apos;s settings and turn on <strong>Show in Share Sheet</strong> to send selected text from Notes, Safari or Messages straight to TaskFlow.</>,
            <>Say <strong>“Hey Siri, Add to TaskFlow”</strong>, add it to your Home Screen, or map it to the Action Button / Back Tap.</>,
          ]}
        />
        <p className="text-xs leading-relaxed rounded-lg border border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300 p-3">
          Heads-up: Shortcuts opens the link in Safari. On iPhone a site added to the Home Screen <em>as an app</em> keeps
          separate storage from Safari, so use TaskFlow in Safari (or add it to the Home Screen with “Open as Web App” off).
        </p>
      </Section>

      <Section icon={ClipboardList} title="Apple Notes (and Reminders)">
        <Steps
          items={[
            <>In Notes, select your checklist or bullet list and tap <strong>Copy</strong>.</>,
            <>Come back here (or the Dashboard) and press <strong>Import</strong> — or just paste into Quick Add.</>,
            <>Review the preview and tap <strong>Add</strong>. Bullets, numbers and checkboxes are cleaned up; items already checked off are skipped.</>,
          ]}
        />
        <button onClick={() => setShowImport(true)} className="btn-primary text-sm">
          <ClipboardList className="w-4 h-4" /> Paste a list now
        </button>
        <p className="text-sm text-secondary-fg">
          Want it automatic? In Shortcuts use <strong>Find Notes</strong> → <strong>Get Details of Notes</strong> (Body) and pass the
          result to the same <strong>Text → Open URLs</strong> steps above — each line becomes a task.
        </p>
      </Section>

      <Section icon={Send} title="Telegram">
        <p className="text-sm text-secondary-fg">
          Message your own bot from any device and the text becomes a task. Set it up once in{" "}
          <Link href="/settings" className="text-primary font-medium hover:underline">Settings → Telegram</Link>.
        </p>
      </Section>

      <Section icon={Bookmark} title="Browser bookmarklet (desktop)">
        <Steps
          items={[
            <>Create a new bookmark in your browser (any page).</>,
            <>Edit it: name “Add to TaskFlow”, and paste the code below as the URL.</>,
            <>Click it on any page, type the task, and TaskFlow opens with it added.</>,
          ]}
        />
        <CopyBlock label="Bookmarklet" value={bookmarklet} />
      </Section>

      <Section icon={Mic} title="What you can write">
        <ul className="text-sm text-secondary-fg space-y-1.5">
          <li><strong>Dates:</strong> today, tomorrow, Friday, next week, in 3 days, 2026-12-31 — or اليوم، بكرة، بعد غد، الخميس، الأسبوع القادم</li>
          <li><strong>Priority:</strong> <code className="bg-secondary px-1 rounded">!urgent</code> <code className="bg-secondary px-1 rounded">!high</code> <code className="bg-secondary px-1 rounded">!low</code> — or <code className="bg-secondary px-1 rounded" dir="rtl">!عاجل !مهم</code></li>
          <li><strong>Category:</strong> <code className="bg-secondary px-1 rounded">#work</code> <code className="bg-secondary px-1 rounded">#health</code> … or <code className="bg-secondary px-1 rounded" dir="rtl">#عمل #صحة #شخصي</code></li>
          <li><strong>Example:</strong> <span dir="auto">Pay the invoice Thursday !high #finance</span> · <span dir="auto">اشتري حليب بكرة #صحة</span></li>
        </ul>
      </Section>

      {showImport && <ImportTasksModal onClose={() => setShowImport(false)} />}
    </div>
  );
}
