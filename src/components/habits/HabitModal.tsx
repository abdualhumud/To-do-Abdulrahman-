"use client";

import { useState } from "react";
import { Habit } from "@/types";
import { useHabitStore } from "@/store/useHabitStore";
import { X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import toast from "react-hot-toast";

const HABIT_ICONS = ["💪", "📚", "🏃", "🧘", "💧", "🍎", "😴", "✍️", "🎯", "🏋️", "🧹", "🎸", "🌿", "💊", "🧠", "🙏"];
const HABIT_COLORS = ["#6366f1", "#ec4899", "#14b8a6", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#22c55e", "#f97316", "#84cc16"];

interface HabitModalProps {
  habit?: Habit | null;
  onClose: () => void;
}

export function HabitModal({ habit, onClose }: HabitModalProps) {
  const { createHabit, updateHabit } = useHabitStore();
  const [loading, setLoading] = useState(false);
  const [title, setTitle] = useState(habit?.title || "");
  const [description, setDescription] = useState(habit?.description || "");
  const [icon, setIcon] = useState(habit?.icon || "💪");
  const [color, setColor] = useState(habit?.color || HABIT_COLORS[0]);
  const [frequency, setFrequency] = useState<"daily" | "weekly">(habit?.frequency || "daily");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) { toast.error("Title is required"); return; }
    setLoading(true);

    if (habit) {
      await updateHabit(habit.id, { title, description, icon, color, frequency });
      toast.success("Habit updated!");
    } else {
      await createHabit({ title, description, icon, color, frequency });
      toast.success("Habit created!");
    }

    setLoading(false);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md card shadow-2xl animate-slide-up">
        <div className="flex items-center justify-between p-5 border-b border-base">
          <h2 className="font-bold text-base-fg">{habit ? "Edit Habit" : "New Habit"}</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-fg hover:bg-secondary hover:text-base-fg transition-all">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-5">
          {/* Icon & Color */}
          <div className="flex items-center gap-4">
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl flex-shrink-0"
              style={{ background: color + "22" }}
            >
              {icon}
            </div>
            <div className="flex-1">
              <p className="text-xs font-medium text-secondary-fg mb-2">Choose color</p>
              <div className="flex flex-wrap gap-2">
                {HABIT_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    className={cn("w-6 h-6 rounded-full transition-transform", color === c && "scale-125 ring-2 ring-offset-1 ring-current")}
                    style={{ background: c, color: c }}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Icon picker */}
          <div>
            <p className="text-xs font-medium text-secondary-fg mb-2">Choose icon</p>
            <div className="flex flex-wrap gap-2">
              {HABIT_ICONS.map((ic) => (
                <button
                  key={ic}
                  type="button"
                  onClick={() => setIcon(ic)}
                  className={cn("w-9 h-9 rounded-lg flex items-center justify-center text-lg transition-all hover:bg-secondary", icon === ic && "bg-accent ring-2 ring-primary")}
                >
                  {ic}
                </button>
              ))}
            </div>
          </div>

          {/* Title */}
          <div>
            <label className="block text-sm font-medium text-base-fg mb-1.5">Habit Name *</label>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} className="input-base" placeholder="e.g., Morning Workout" required />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-base-fg mb-1.5">Description</label>
            <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} className="input-base" placeholder="Add a motivating note..." />
          </div>

          {/* Frequency */}
          <div>
            <label className="block text-sm font-medium text-base-fg mb-1.5">Frequency</label>
            <div className="flex gap-2">
              {(["daily", "weekly"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFrequency(f)}
                  className={cn("flex-1 py-2 rounded-lg text-sm font-medium capitalize transition-all", frequency === f ? "bg-primary text-white" : "bg-secondary text-secondary-fg hover:bg-border")}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1 justify-center">Cancel</button>
            <button type="submit" disabled={loading} className="btn-primary flex-1 justify-center">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {loading ? "Saving..." : habit ? "Update" : "Create Habit"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
