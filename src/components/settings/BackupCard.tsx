"use client";

import { useRef } from "react";
import { Download, HardDrive, Upload } from "lucide-react";
import toast from "react-hot-toast";
import { downloadBackup, importBackup } from "@/lib/backup";
import { useTaskStore } from "@/store/useTaskStore";
import { useHabitStore } from "@/store/useHabitStore";
import { useT } from "@/lib/i18n";

const MAX_BACKUP_BYTES = 20 * 1024 * 1024;

export function BackupCard() {
  const t = useT();
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > MAX_BACKUP_BYTES) {
      toast.error(t("That file is too large to be a TaskFlow backup"));
      return;
    }
    try {
      const summary = importBackup(JSON.parse(await file.text()));
      await Promise.all([
        useTaskStore.getState().fetchTasks(),
        useTaskStore.getState().fetchTags(),
        useHabitStore.getState().fetchHabits(),
      ]);
      const msg = t("Imported {tasks} tasks, {habits} habits", { tasks: summary.tasks, habits: summary.habits });
      toast.success(summary.skipped ? `${msg} ${t("({n} invalid skipped)", { n: summary.skipped })}` : msg);
    } catch (err) {
      toast.error(err instanceof SyntaxError ? t("That file isn't valid JSON") : err instanceof Error ? err.message : t("Import failed"));
    }
  }

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center gap-2">
        <HardDrive className="w-4 h-4 text-secondary-fg" />
        <h2 className="font-semibold text-base-fg">{t("Backup")}</h2>
      </div>
      <p className="text-sm text-secondary-fg">
        {t("Your data lives only in this browser. Export a backup now and then — and use it to move to another device. Importing merges with what you have; nothing is overwritten.")}
      </p>
      <div className="flex flex-wrap gap-2">
        <button onClick={downloadBackup} className="btn-secondary text-sm">
          <Download className="w-4 h-4" /> {t("Export backup")}
        </button>
        <button onClick={() => fileRef.current?.click()} className="btn-secondary text-sm">
          <Upload className="w-4 h-4" /> {t("Import backup")}
        </button>
        <input ref={fileRef} type="file" accept="application/json,.json" onChange={handleFile} className="hidden" />
      </div>
    </div>
  );
}
