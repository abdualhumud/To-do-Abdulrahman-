"use client";

import { Calendar, Flag, Folder } from "lucide-react";
import type { ParsedTask } from "@/lib/task-parser";
import { formatDate } from "@/lib/utils";

export function TaskPreviewChips({ task }: { task: ParsedTask }) {
  if (!task.due_date && !task.priority && !task.category) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {task.due_date && (
        <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-md bg-accent text-accent-fg">
          <Calendar className="w-3 h-3" />
          {formatDate(task.due_date)}
        </span>
      )}
      {task.priority && (
        <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-md bg-secondary text-secondary-fg capitalize">
          <Flag className="w-3 h-3" />
          {task.priority}
        </span>
      )}
      {task.category && (
        <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-md bg-secondary text-secondary-fg capitalize">
          <Folder className="w-3 h-3" />
          {task.category}
        </span>
      )}
    </span>
  );
}
