"use client";

import { Task } from "@/types";
import { useTaskStore } from "@/store/useTaskStore";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn, formatDate, isOverdue, isDueToday } from "@/lib/utils";
import {
  GripVertical,
  Calendar,
  Edit2,
  Trash2,
  ChevronDown,
  ChevronUp,
  CheckSquare,
  Square,
  Plus,
} from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast";

const PRIORITY_CONFIG = {
  urgent: { label: "Urgent", color: "text-danger", bg: "rgba(239,68,68,0.1)", dot: "bg-red-500" },
  high: { label: "High", color: "text-warning", bg: "rgba(245,158,11,0.1)", dot: "bg-amber-500" },
  medium: { label: "Medium", color: "text-primary", bg: "rgb(var(--accent))", dot: "bg-indigo-500" },
  low: { label: "Low", color: "text-success", bg: "rgba(34,197,94,0.1)", dot: "bg-green-500" },
};

const CATEGORY_EMOJI: Record<string, string> = {
  work: "💼", personal: "👤", health: "💪", learning: "📚",
  finance: "💰", social: "🤝", other: "📌",
};

interface TaskCardProps {
  task: Task;
  onEdit: (task: Task) => void;
}

export function TaskCard({ task, onEdit }: TaskCardProps) {
  const { toggleTask, deleteTask, createSubTask, toggleSubTask, deleteSubTask } = useTaskStore();
  const [showSubtasks, setShowSubtasks] = useState(false);
  const [newSubtask, setNewSubtask] = useState("");
  const [addingSubtask, setAddingSubtask] = useState(false);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const priorityConf = PRIORITY_CONFIG[task.priority];
  const isCompleted = task.status === "completed";
  const overdue = !isCompleted && isOverdue(task.due_date);
  const dueToday = !isCompleted && isDueToday(task.due_date);
  const subtaskCount = task.subtasks?.length || 0;
  const completedSubtasks = task.subtasks?.filter((s) => s.completed).length || 0;

  async function handleAddSubtask() {
    if (!newSubtask.trim()) return;
    await createSubTask(task.id, newSubtask.trim());
    setNewSubtask("");
    setAddingSubtask(false);
    setShowSubtasks(true);
  }

  async function handleDelete() {
    if (!confirm("Delete this task?")) return;
    await deleteTask(task.id);
    toast.success("Task deleted");
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "card p-4 group transition-all duration-150 hover:shadow-md",
        `priority-${task.priority}`,
        isCompleted && "opacity-60"
      )}
    >
      <div className="flex items-start gap-3">
        {/* Drag handle */}
        <button
          {...attributes}
          {...listeners}
          className="mt-0.5 text-muted-fg hover:text-secondary-fg cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
        >
          <GripVertical className="w-4 h-4" />
        </button>

        {/* Checkbox */}
        <button
          onClick={() => toggleTask(task.id)}
          className={cn(
            "mt-0.5 flex-shrink-0 transition-colors",
            isCompleted ? "text-success" : "text-muted-fg hover:text-primary"
          )}
        >
          {isCompleted ? <CheckSquare className="w-5 h-5" /> : <Square className="w-5 h-5" />}
        </button>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <p className={cn("font-medium text-base-fg text-sm leading-snug", isCompleted && "line-through text-muted-fg")}>
                {CATEGORY_EMOJI[task.category] || "📌"} {task.title}
              </p>
              {task.description && (
                <p className="text-xs text-muted-fg mt-1 line-clamp-2">{task.description}</p>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
              <button
                onClick={() => onEdit(task)}
                className="w-7 h-7 rounded-md flex items-center justify-center text-muted-fg hover:bg-secondary hover:text-base-fg transition-all"
              >
                <Edit2 className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={handleDelete}
                className="w-7 h-7 rounded-md flex items-center justify-center text-muted-fg hover:bg-red-50 hover:text-danger dark:hover:bg-red-900/20 transition-all"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Meta row */}
          <div className="flex flex-wrap items-center gap-2 mt-2">
            {/* Priority badge */}
            <span
              className={cn("inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium", priorityConf.color)}
              style={{ background: priorityConf.bg }}
            >
              <span className={cn("w-1.5 h-1.5 rounded-full", priorityConf.dot)} />
              {priorityConf.label}
            </span>

            {/* Category */}
            <span className="text-xs text-secondary-fg bg-secondary px-2 py-0.5 rounded-full capitalize">
              {task.category}
            </span>

            {/* Tags */}
            {task.tags?.map((tag) => (
              <span
                key={tag.id}
                className="text-xs px-2 py-0.5 rounded-full font-medium"
                style={{ background: tag.color + "22", color: tag.color }}
              >
                #{tag.name}
              </span>
            ))}

            {/* Due date */}
            {task.due_date && (
              <span
                className={cn(
                  "inline-flex items-center gap-1 text-xs",
                  overdue ? "text-danger" : dueToday ? "text-warning" : "text-muted-fg"
                )}
              >
                <Calendar className="w-3 h-3" />
                {overdue ? "Overdue · " : dueToday ? "Today · " : ""}{formatDate(task.due_date)}
              </span>
            )}

            {/* Subtasks */}
            {subtaskCount > 0 && (
              <button
                onClick={() => setShowSubtasks(!showSubtasks)}
                className="inline-flex items-center gap-1 text-xs text-secondary-fg hover:text-base-fg"
              >
                {completedSubtasks}/{subtaskCount} subtasks
                {showSubtasks ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>
            )}
          </div>

          {/* Subtasks */}
          {showSubtasks && subtaskCount > 0 && (
            <div className="mt-3 space-y-1.5 pl-1 border-l-2 border-base ml-1 animate-slide-up">
              {task.subtasks?.map((sub) => (
                <div key={sub.id} className="flex items-center gap-2 group/sub">
                  <button
                    onClick={() => toggleSubTask(sub.id, task.id, !sub.completed)}
                    className={cn("flex-shrink-0", sub.completed ? "text-success" : "text-muted-fg hover:text-primary")}
                  >
                    {sub.completed ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                  </button>
                  <span className={cn("text-xs flex-1", sub.completed && "line-through text-muted-fg")}>
                    {sub.title}
                  </span>
                  <button
                    onClick={() => deleteSubTask(sub.id, task.id)}
                    className="opacity-0 group-hover/sub:opacity-100 text-muted-fg hover:text-danger transition-all"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Add subtask */}
          <div className="mt-2">
            {addingSubtask ? (
              <div className="flex items-center gap-2 animate-slide-up">
                <input
                  type="text"
                  value={newSubtask}
                  onChange={(e) => setNewSubtask(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleAddSubtask(); if (e.key === "Escape") setAddingSubtask(false); }}
                  className="input-base h-7 py-0 text-xs flex-1"
                  placeholder="Subtask title..."
                  autoFocus
                />
                <button onClick={handleAddSubtask} className="text-xs text-primary hover:underline">Add</button>
                <button onClick={() => setAddingSubtask(false)} className="text-xs text-muted-fg hover:underline">Cancel</button>
              </div>
            ) : (
              <button
                onClick={() => setAddingSubtask(true)}
                className="text-xs text-muted-fg hover:text-primary flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <Plus className="w-3 h-3" /> Add subtask
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
