"use client";

import { useEffect, useMemo, useState } from "react";
import { ClipboardPaste, X } from "lucide-react";
import toast from "react-hot-toast";
import { useTaskStore } from "@/store/useTaskStore";
import { MAX_TASKS_PER_BATCH, parseTasksFromText } from "@/lib/task-parser";
import { taskFromParsed } from "@/lib/reminder-fields";
import { TaskPreviewChips } from "@/components/capture/TaskPreviewChips";
import { useT } from "@/lib/i18n";

interface Props {
  initialText?: string;
  onClose: () => void;
}

/** Paste a list from Apple Notes, Reminders, Telegram… — one task per line. */
export function ImportTasksModal({ initialText = "", onClose }: Props) {
  const t = useT();
  const createTasks = useTaskStore((s) => s.createTasks);
  const [text, setText] = useState(initialText);
  const [saving, setSaving] = useState(false);
  const tasks = useMemo(() => parseTasksFromText(text), [text]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function pasteFromClipboard() {
    try {
      setText(await navigator.clipboard.readText());
    } catch {
      toast.error(t("Clipboard access was blocked — paste into the box instead"));
    }
  }

  async function handleAdd() {
    if (tasks.length === 0 || saving) return;
    setSaving(true);
    const created = await createTasks(tasks.map((t) => taskFromParsed(t)));
    toast.success(created.length === 1 ? t("Added {n} task", { n: created.length }) : t("Added {n} tasks", { n: created.length }));
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4 animate-fade-in"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-title"
        className="bg-card border border-base rounded-2xl shadow-lg w-full max-w-lg max-h-[92dvh] sm:max-h-[90vh] flex flex-col animate-slide-up rounded-b-none sm:rounded-b-2xl pb-[env(safe-area-inset-bottom)]"
      >
        <div className="flex items-start justify-between gap-3 p-5 pb-3">
          <div>
            <h2 id="import-title" className="font-semibold text-base-fg">{t("Import a list")}</h2>
            <p className="text-sm text-secondary-fg mt-0.5">
              {t("Paste from Notes, Reminders or anywhere — one task per line. Dates, #category and !priority are understood.")}
            </p>
          </div>
          <button onClick={onClose} aria-label={t("Close")} className="text-muted-fg hover:text-base-fg">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 space-y-3 overflow-y-auto">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === "Enter" && handleAdd()}
            className="input-base min-h-32 resize-y"
            placeholder={t("- Buy milk tomorrow\n- Call the dentist Thursday !high\n- اشتري خبز بكرة")}
            dir="auto"
            autoFocus
          />

          <button onClick={pasteFromClipboard} className="btn-ghost text-xs px-2 py-1">
            <ClipboardPaste className="w-3.5 h-3.5" /> {t("Paste from clipboard")}
          </button>

          {tasks.length > 0 && (
            <ul className="space-y-1.5 pb-1">
              {tasks.map((t, i) => (
                <li key={i} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-base-fg" dir="auto">{t.title}</span>
                  <TaskPreviewChips task={t} />
                </li>
              ))}
            </ul>
          )}
          {tasks.length >= MAX_TASKS_PER_BATCH && (
            <p className="text-xs text-warning">{t("Only the first {n} lines are imported at once.", { n: MAX_TASKS_PER_BATCH })}</p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 p-5 pt-3">
          <button onClick={onClose} className="btn-secondary">{t("Cancel")}</button>
          <button onClick={handleAdd} disabled={tasks.length === 0 || saving} className="btn-primary disabled:opacity-50">
            {tasks.length === 0 ? t("Add tasks") : tasks.length === 1 ? t("Add {n} task", { n: tasks.length }) : t("Add {n} tasks", { n: tasks.length })}
          </button>
        </div>
      </div>
    </div>
  );
}
