"use client";

import { useHabitStore } from "@/store/useHabitStore";
import { useTaskStore } from "@/store/useTaskStore";

/** Re-reads everything from local-store into the Zustand stores. */
export function refreshStores(): void {
  void useTaskStore.getState().fetchTasks();
  void useTaskStore.getState().fetchTags();
  void useHabitStore.getState().fetchHabits();
}
