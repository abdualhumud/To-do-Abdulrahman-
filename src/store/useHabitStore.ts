"use client";

import { create } from "zustand";
import { Habit, HabitCompletion } from "@/types";
import { localHabits, localCompletions, localUser } from "@/lib/local-store";

interface HabitStore {
  habits: Habit[];
  isLoading: boolean;

  fetchHabits: () => Promise<void>;
  createHabit: (habit: Partial<Habit>) => Promise<void>;
  updateHabit: (id: string, updates: Partial<Habit>) => Promise<void>;
  deleteHabit: (id: string) => Promise<void>;
  toggleHabitCompletion: (habitId: string, date: string) => Promise<void>;
  isCompletedToday: (habit: Habit) => boolean;
}

function uuid() {
  return crypto.randomUUID();
}

function now() {
  return new Date().toISOString();
}

function sevenDaysAgo() {
  return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
}

export const useHabitStore = create<HabitStore>((set, get) => ({
  habits: [],
  isLoading: false,

  fetchHabits: async () => {
    set({ isLoading: true });
    const cutoff = sevenDaysAgo();
    // Use async reads so encrypted localStorage data is decrypted on page load
    const allHabits: Habit[] = await localHabits.getAsync();
    const allCompletions: HabitCompletion[] = await localCompletions.getAsync();

    // Attach recent completions to each habit (last 7 days)
    const habits = allHabits.map((h) => ({
      ...h,
      completions: allCompletions.filter(
        (c) => c.habit_id === h.id && c.completed_at >= cutoff
      ),
    }));

    set({ habits, isLoading: false });
  },

  createHabit: async (habit) => {
    const user = localUser.get();
    if (!user) return;

    const newHabit: Habit = {
      id: uuid(),
      user_id: user.id,
      title: habit.title || "",
      description: habit.description ?? null,
      icon: habit.icon || "⭐",
      color: habit.color || "#6366f1",
      frequency: habit.frequency || "daily",
      target_count: habit.target_count || 1,
      created_at: now(),
      completions: [],
    };

    const habits = [...localHabits.get(), newHabit];
    localHabits.set(habits);
    await get().fetchHabits();
  },

  updateHabit: async (id, updates) => {
    const habits = localHabits.get().map((h: Habit) =>
      h.id === id ? { ...h, ...updates } : h
    );
    localHabits.set(habits);
    await get().fetchHabits();
  },

  deleteHabit: async (id) => {
    localHabits.set(localHabits.get().filter((h: Habit) => h.id !== id));
    // Also remove completions for this habit
    localCompletions.set(
      localCompletions.get().filter((c: HabitCompletion) => c.habit_id !== id)
    );
    set((state) => ({ habits: state.habits.filter((h) => h.id !== id) }));
  },

  toggleHabitCompletion: async (habitId, date) => {
    const user = localUser.get();
    if (!user) return;

    const completions: HabitCompletion[] = localCompletions.get();
    const existing = completions.find(
      (c) => c.habit_id === habitId && c.completed_at === date
    );

    if (existing) {
      localCompletions.set(completions.filter((c) => c !== existing));
    } else {
      localCompletions.set([
        ...completions,
        { id: uuid(), habit_id: habitId, user_id: user.id, completed_at: date, notes: null },
      ]);
    }

    await get().fetchHabits();
  },

  isCompletedToday: (habit) => {
    const today = new Date().toISOString().split("T")[0];
    return habit.completions?.some((c) => c.completed_at === today) ?? false;
  },
}));
