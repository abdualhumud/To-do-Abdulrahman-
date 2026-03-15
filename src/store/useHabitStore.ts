"use client";

import { create } from "zustand";
import { Habit, HabitCompletion } from "@/types";
import { createClient } from "@/lib/supabase/client";

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

export const useHabitStore = create<HabitStore>((set, get) => ({
  habits: [],
  isLoading: false,

  fetchHabits: async () => {
    const supabase = createClient();
    set({ isLoading: true });
    const today = new Date().toISOString().split("T")[0];
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

    const { data } = await supabase
      .from("habits")
      .select(`*, completions:habit_completions(*)`)
      .gte("habit_completions.completed_at", sevenDaysAgo)
      .order("created_at", { ascending: true });

    set({ habits: data || [], isLoading: false });
  },

  createHabit: async (habit) => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from("habits").insert({ ...habit, user_id: user.id });
    await get().fetchHabits();
  },

  updateHabit: async (id, updates) => {
    const supabase = createClient();
    await supabase.from("habits").update(updates).eq("id", id);
    await get().fetchHabits();
  },

  deleteHabit: async (id) => {
    const supabase = createClient();
    await supabase.from("habits").delete().eq("id", id);
    set((state) => ({ habits: state.habits.filter((h) => h.id !== id) }));
  },

  toggleHabitCompletion: async (habitId, date) => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const habit = get().habits.find((h) => h.id === habitId);
    const isCompleted = habit?.completions?.some((c) => c.completed_at === date);

    if (isCompleted) {
      await supabase.from("habit_completions").delete()
        .eq("habit_id", habitId).eq("completed_at", date);
    } else {
      await supabase.from("habit_completions").insert({ habit_id: habitId, user_id: user.id, completed_at: date });
    }
    await get().fetchHabits();
  },

  isCompletedToday: (habit) => {
    const today = new Date().toISOString().split("T")[0];
    return habit.completions?.some((c) => c.completed_at === today) ?? false;
  },
}));
