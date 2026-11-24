import { todayLocal } from "@/lib/utils";
import { tr } from "@/lib/i18n";
import {
  CompletionSchema,
  HabitSchema,
  TagSchema,
  TaskSchema,
  localCompletions,
  localHabits,
  localTags,
  localTasks,
  type AnyArray,
} from "@/lib/local-store";
import type { z } from "zod";

export interface BackupFile {
  app: "taskflow";
  version: 1;
  exported_at: string;
  tasks: AnyArray;
  tags: AnyArray;
  habits: AnyArray;
  completions: AnyArray;
}

export interface ImportSummary {
  tasks: number;
  tags: number;
  habits: number;
  completions: number;
  skipped: number;
}

// The Telegram bot token and the user profile are deliberately NOT exported.
export function buildBackup(): BackupFile {
  return {
    app: "taskflow",
    version: 1,
    exported_at: new Date().toISOString(),
    tasks: localTasks.get(),
    tags: localTags.get(),
    habits: localHabits.get(),
    completions: localCompletions.get(),
  };
}

export function downloadBackup(): void {
  const blob = new Blob([JSON.stringify(buildBackup(), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `taskflow-backup-${todayLocal()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function mergeById(
  existing: AnyArray,
  incoming: unknown,
  schema: z.ZodType,
  skipped: { n: number },
): { merged: AnyArray; added: number } {
  if (!Array.isArray(incoming)) return { merged: existing, added: 0 };
  const known = new Set(existing.map((item) => item.id));
  const merged = [...existing];
  let added = 0;
  for (const item of incoming) {
    if (!schema.safeParse(item).success) {
      skipped.n++;
      continue;
    }
    if (known.has(item.id)) continue; // keep what is already here
    known.add(item.id);
    merged.push(item);
    added++;
  }
  return { merged, added };
}

/** Merges a backup into the current data (existing items win). Throws on a non-TaskFlow file. */
export function importBackup(json: unknown): ImportSummary {
  if (typeof json !== "object" || json === null || (json as { app?: unknown }).app !== "taskflow") {
    throw new Error(tr("This file is not a TaskFlow backup"));
  }
  const file = json as Partial<BackupFile>;
  const skipped = { n: 0 };

  const tasks = mergeById(localTasks.get(), file.tasks, TaskSchema, skipped);
  const tags = mergeById(localTags.get(), file.tags, TagSchema, skipped);
  const habits = mergeById(localHabits.get(), file.habits, HabitSchema, skipped);
  const completions = mergeById(localCompletions.get(), file.completions, CompletionSchema, skipped);

  if (tasks.added) localTasks.set(tasks.merged);
  if (tags.added) localTags.set(tags.merged);
  if (habits.added) localHabits.set(habits.merged);
  if (completions.added) localCompletions.set(completions.merged);

  return {
    tasks: tasks.added,
    tags: tags.added,
    habits: habits.added,
    completions: completions.added,
    skipped: skipped.n,
  };
}
