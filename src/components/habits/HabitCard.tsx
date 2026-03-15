"use client";

import { Habit } from "@/types";
import { useHabitStore } from "@/store/useHabitStore";
import { Check, Edit2, Trash2, Flame } from "lucide-react";
import { cn } from "@/lib/utils";
import { format, subDays } from "date-fns";
import toast from "react-hot-toast";

interface HabitCardProps {
  habit: Habit;
  onEdit: (habit: Habit) => void;
}

export function HabitCard({ habit, onEdit }: HabitCardProps) {
  const { toggleHabitCompletion, deleteHabit, isCompletedToday } = useHabitStore();
  const todayStr = new Date().toISOString().split("T")[0];
  const completed = isCompletedToday(habit);

  // Calculate streak
  let streak = 0;
  let d = new Date();
  while (true) {
    const dateStr = format(d, "yyyy-MM-dd");
    if (habit.completions?.some((c) => c.completed_at === dateStr)) {
      streak++;
      d = subDays(d, 1);
    } else {
      break;
    }
  }

  // Last 7 days
  const last7 = Array.from({ length: 7 }, (_, i) => {
    const date = subDays(new Date(), 6 - i);
    const dateStr = format(date, "yyyy-MM-dd");
    return {
      dateStr,
      label: format(date, "EEE"),
      done: habit.completions?.some((c) => c.completed_at === dateStr) ?? false,
    };
  });

  async function handleDelete() {
    if (!confirm("Delete this habit?")) return;
    await deleteHabit(habit.id);
    toast.success("Habit deleted");
  }

  return (
    <div className={cn("card p-4 group", completed && "ring-1 ring-success/30")}>
      <div className="flex items-start gap-4">
        {/* Icon */}
        <div
          className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl flex-shrink-0"
          style={{ background: habit.color + "22" }}
        >
          {habit.icon}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="font-semibold text-base-fg">{habit.title}</h3>
              {habit.description && (
                <p className="text-xs text-secondary-fg mt-0.5">{habit.description}</p>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={() => onEdit(habit)}
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

          {/* Stats */}
          <div className="flex items-center gap-4 mt-2">
            <div className="flex items-center gap-1 text-xs text-secondary-fg">
              <Flame className={cn("w-3.5 h-3.5", streak > 0 ? "text-orange-500" : "text-muted-fg")} />
              <span>{streak} day streak</span>
            </div>
            <span className="text-xs capitalize text-muted-fg">{habit.frequency}</span>
          </div>

          {/* Weekly dots */}
          <div className="flex items-center gap-1.5 mt-3">
            {last7.map((day, i) => (
              <div key={i} className="flex flex-col items-center gap-1">
                <div
                  className={cn(
                    "w-7 h-7 rounded-lg flex items-center justify-center transition-all",
                    day.done ? "text-white shadow-sm" : "bg-secondary"
                  )}
                  style={day.done ? { background: habit.color } : {}}
                  title={day.dateStr}
                >
                  {day.done && <Check className="w-3.5 h-3.5" />}
                </div>
                <span className="text-xs text-muted-fg">{day.label.slice(0, 1)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Complete button */}
        <button
          onClick={() => toggleHabitCompletion(habit.id, todayStr)}
          className={cn(
            "w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-all font-bold",
            completed
              ? "text-white shadow-md"
              : "bg-secondary text-secondary-fg hover:text-white hover:shadow-md"
          )}
          style={completed ? { background: habit.color } : { ["--hover-bg" as string]: habit.color }}
          onMouseEnter={(e) => { if (!completed) (e.currentTarget as HTMLButtonElement).style.background = habit.color; }}
          onMouseLeave={(e) => { if (!completed) (e.currentTarget as HTMLButtonElement).style.background = ""; }}
        >
          <Check className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}
