"use client";

import { useEffect, useState } from "react";
import { useHabitStore } from "@/store/useHabitStore";
import { HabitCard } from "@/components/habits/HabitCard";
import { HabitModal } from "@/components/habits/HabitModal";
import { Flame, Plus } from "lucide-react";
import { Habit } from "@/types";

export default function HabitsPage() {
  const { habits, fetchHabits } = useHabitStore();
  const [showModal, setShowModal] = useState(false);
  const [editingHabit, setEditingHabit] = useState<Habit | null>(null);

  useEffect(() => {
    fetchHabits();
  }, [fetchHabits]);

  const todayStr = new Date().toISOString().split("T")[0];
  const completedToday = habits.filter((h) =>
    h.completions?.some((c) => c.completed_at === todayStr)
  ).length;

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-20 md:pb-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-orange-100 dark:bg-orange-900/30 rounded-xl flex items-center justify-center">
            <Flame className="w-5 h-5 text-orange-500" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-base-fg">Habits</h1>
            <p className="text-sm text-secondary-fg">
              {completedToday} / {habits.length} done today
            </p>
          </div>
        </div>
        <button onClick={() => setShowModal(true)} className="btn-primary">
          <Plus className="w-4 h-4" /> New Habit
        </button>
      </div>

      {/* Progress bar */}
      {habits.length > 0 && (
        <div className="card p-4">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="font-medium text-base-fg">Today&apos;s Progress</span>
            <span className="text-secondary-fg">{Math.round((completedToday / habits.length) * 100)}%</span>
          </div>
          <div className="h-2.5 bg-secondary rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-500"
              style={{ width: `${(completedToday / habits.length) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Habits grid */}
      {habits.length === 0 ? (
        <div className="card p-16 flex flex-col items-center justify-center text-center">
          <div className="w-16 h-16 bg-orange-100 dark:bg-orange-900/20 rounded-2xl flex items-center justify-center mb-4 text-3xl">
            🔥
          </div>
          <h3 className="font-semibold text-base-fg mb-1">No habits yet</h3>
          <p className="text-secondary-fg text-sm mb-4">Start building powerful daily routines</p>
          <button onClick={() => setShowModal(true)} className="btn-primary">
            <Plus className="w-4 h-4" /> Create your first habit
          </button>
        </div>
      ) : (
        <div className="grid gap-4">
          {habits.map((habit) => (
            <HabitCard
              key={habit.id}
              habit={habit}
              onEdit={(h) => { setEditingHabit(h); setShowModal(true); }}
            />
          ))}
        </div>
      )}

      {showModal && (
        <HabitModal
          habit={editingHabit}
          onClose={() => { setShowModal(false); setEditingHabit(null); }}
        />
      )}
    </div>
  );
}
