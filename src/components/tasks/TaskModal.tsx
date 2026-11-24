"use client";

import { useState, useEffect } from "react";
import { Task, Priority, Category, Tag } from "@/types";
import { useTaskStore } from "@/store/useTaskStore";
import { X, Plus, Loader2, CalendarPlus } from "lucide-react";
import { cn, todayLocal } from "@/lib/utils";
import toast from "react-hot-toast";
import { useT } from "@/lib/i18n";
import { ReminderFields, type ReminderValue } from "@/components/tasks/ReminderFields";
import { CalendarSheet } from "@/components/tasks/CalendarSheet";
import { usePrefs, useTelegramConfig } from "@/lib/use-local-store";
import { defaultChannels, fromLocalInput, toLocalInput } from "@/lib/reminders";

interface TaskModalProps {
  task?: Task | null;
  onClose: () => void;
}

const PRIORITIES: Priority[] = ["low", "medium", "high", "urgent"];
const CATEGORIES: Category[] = ["work", "personal", "health", "learning", "finance", "social", "other"];

const PRIORITY_LABELS: Record<Priority, string> = { low: "Low", medium: "Medium", high: "High", urgent: "Urgent" };
const CATEGORY_LABELS: Record<Category, string> = {
  work: "Work", personal: "Personal", health: "Health", learning: "Learning",
  finance: "Finance", social: "Social", other: "Other",
};
const STATUS_LABELS: Record<string, string> = {
  pending: "Pending", in_progress: "In progress", completed: "Completed", cancelled: "Cancelled",
};

const PRIORITY_COLORS: Record<Priority, string> = {
  low: "#22c55e",
  medium: "#6366f1",
  high: "#f59e0b",
  urgent: "#ef4444",
};

const TAG_COLORS = ["#6366f1", "#ec4899", "#14b8a6", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#22c55e"];

export function TaskModal({ task, onClose }: TaskModalProps) {
  const t = useT();
  const { createTask, updateTask, tags, createTag } = useTaskStore();
  const [loading, setLoading] = useState(false);
  const [title, setTitle] = useState(task?.title || "");
  const [description, setDescription] = useState(task?.description || "");
  const [priority, setPriority] = useState<Priority>(task?.priority || "medium");
  const [category, setCategory] = useState<Category>(task?.category || "personal");
  const [status, setStatus] = useState(task?.status || "pending");
  const [dueDate, setDueDate] = useState(task?.due_date || "");
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>(task?.tags?.map((t) => t.id) || []);
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState(TAG_COLORS[0]);
  const [showTagInput, setShowTagInput] = useState(false);
  const [reminder, setReminder] = useState<ReminderValue>(() => ({
    enabled: Boolean(task?.reminder_at),
    at: toLocalInput(task?.reminder_at),
    repeat: task?.repeat ?? "none",
    channels: task?.reminder_channels ?? [],
  }));
  const [showCalendar, setShowCalendar] = useState(false);
  const serverReady = useTelegramConfig()?.mode === "server";
  const syncOn = usePrefs().syncToServer;

  function toggleReminder(enabled: boolean) {
    if (!enabled) {
      setReminder((r) => ({ ...r, enabled: false }));
      return;
    }
    setReminder((r) => {
      if (r.at) return { ...r, enabled: true, channels: r.channels.length ? r.channels : defaultChannels() };
      const next = new Date();
      next.setMinutes(0, 0, 0);
      next.setHours(next.getHours() + 1);
      const at = dueDate ? `${dueDate}T09:00` : toLocalInput(next.toISOString());
      return { ...r, enabled: true, at, channels: r.channels.length ? r.channels : defaultChannels() };
    });
  }

  useEffect(() => {
    function handleEsc(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [onClose]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) { toast.error(t("Title is required")); return; }
    if (reminder.enabled && !fromLocalInput(reminder.at)) { toast.error(t("Pick a date and time for the reminder")); return; }
    if (reminder.enabled && reminder.channels.length === 0) { toast.error(t("Pick at least one way to be reminded")); return; }
    setLoading(true);

    const taskData = {
      title: title.trim(),
      description: description.trim() || null,
      priority,
      category,
      status,
      due_date: dueDate || null,
      reminder_at: reminder.enabled ? fromLocalInput(reminder.at) : null,
      repeat: reminder.enabled ? reminder.repeat : "none",
      reminder_channels: reminder.enabled ? reminder.channels : [],
    } as Partial<Task>;

    if (task) {
      await updateTask(task.id, taskData, selectedTagIds);
      toast.success(t("Task updated!"));
    } else {
      await createTask(taskData, selectedTagIds);
      toast.success(t("Task created!"));
    }

    setLoading(false);
    onClose();
  }

  async function handleCreateTag() {
    if (!newTagName.trim()) return;
    const tag = await createTag({ name: newTagName.trim(), color: newTagColor });
    if (tag) {
      setSelectedTagIds((prev) => [...prev, tag.id]);
      setNewTagName("");
      setShowTagInput(false);
    }
  }

  function toggleTag(tagId: string) {
    setSelectedTagIds((prev) =>
      prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId]
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg card shadow-2xl animate-slide-up max-h-[92dvh] sm:max-h-[90vh] overflow-y-auto overscroll-contain rounded-b-none sm:rounded-b-2xl pb-[env(safe-area-inset-bottom)]">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-base sticky top-0 bg-card z-10">
          <h2 className="font-bold text-base-fg">{task ? t("Edit Task") : t("New Task")}</h2>
          <button onClick={onClose} aria-label={t("Close")} className="w-11 h-11 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center text-muted-fg hover:bg-secondary hover:text-base-fg transition-all">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Title */}
          <div>
            <label className="block text-sm font-medium text-base-fg mb-1.5">{t("Task Title *")}</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="input-base"
              placeholder={t("What needs to be done?")}
              autoFocus
              required
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-base-fg mb-1.5">{t("Description")}</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="input-base resize-none"
              placeholder={t("Add details...")}
              rows={3}
            />
          </div>

          {/* Priority & Category */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-base-fg mb-1.5">{t("Priority")}</label>
              <div className="grid grid-cols-2 gap-1.5">
                {PRIORITIES.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPriority(p)}
                    className={cn(
                      "text-xs py-1.5 px-2 rounded-lg font-medium capitalize border transition-all",
                      priority === p
                        ? "text-white border-transparent"
                        : "border-base text-secondary-fg hover:border-primary"
                    )}
                    style={priority === p ? { background: PRIORITY_COLORS[p], borderColor: PRIORITY_COLORS[p] } : {}}
                  >
                    {t(PRIORITY_LABELS[p])}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-base-fg mb-1.5">{t("Category")}</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as Category)}
                className="input-base capitalize"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c} className="capitalize">{t(CATEGORY_LABELS[c])}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Status & Due Date */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-base-fg mb-1.5">{t("Status")}</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as Task["status"])}
                className="input-base capitalize"
              >
                {["pending", "in_progress", "completed", "cancelled"].map((s) => (
                  <option key={s} value={s}>{t(STATUS_LABELS[s])}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-base-fg mb-1.5">{t("Due Date")}</label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="input-base"
                min={todayLocal()}
              />
            </div>
          </div>

          {/* Reminder */}
          <ReminderFields value={reminder} onChange={setReminder} onToggle={toggleReminder} serverReady={serverReady} syncOn={syncOn} />

          {/* Tags */}
          <div>
            <label className="block text-sm font-medium text-base-fg mb-1.5">{t("Tags")}</label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {tags.map((tag: Tag) => (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => toggleTag(tag.id)}
                  className={cn(
                    "text-xs px-2.5 py-1 rounded-full font-medium border-2 transition-all",
                    selectedTagIds.includes(tag.id) ? "border-current" : "border-transparent opacity-60"
                  )}
                  style={{ background: tag.color + "22", color: tag.color }}
                >
                  #{tag.name}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setShowTagInput(!showTagInput)}
                className="text-xs px-2.5 py-1 rounded-full border border-dashed border-base text-muted-fg hover:text-primary hover:border-primary transition-all flex items-center gap-1"
              >
                <Plus className="w-3 h-3" /> {t("New Tag")}
              </button>
            </div>

            {showTagInput && (
              <div className="flex items-center gap-2 p-3 bg-secondary rounded-xl animate-slide-up">
                <div className="flex gap-1.5">
                  {TAG_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setNewTagColor(c)}
                      className={cn("w-5 h-5 rounded-full transition-transform", newTagColor === c && "scale-125 ring-2 ring-offset-1 ring-current")}
                      style={{ background: c, color: c }}
                    />
                  ))}
                </div>
                <input
                  type="text"
                  value={newTagName}
                  onChange={(e) => setNewTagName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleCreateTag(); } }}
                  className="input-base h-7 py-0 text-xs flex-1"
                  placeholder={t("Tag name...")}
                />
                <button type="button" onClick={handleCreateTag} className="text-xs text-primary font-medium hover:underline">
                  {t("Add")}
                </button>
              </div>
            )}
          </div>

          {task && (
            <button type="button" onClick={() => setShowCalendar(true)} className="btn-ghost text-xs -ms-2">
              <CalendarPlus className="w-4 h-4" /> {t("Add to Apple / Outlook calendar")}
            </button>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1 justify-center">
              {t("Cancel")}
            </button>
            <button type="submit" disabled={loading} className="btn-primary flex-1 justify-center">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {loading ? t("Saving...") : task ? t("Update Task") : t("Create Task")}
            </button>
          </div>
        </form>
      </div>
      {showCalendar && task && <CalendarSheet task={task} onClose={() => setShowCalendar(false)} />}
    </div>
  );
}
