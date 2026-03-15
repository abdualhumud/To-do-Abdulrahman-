"use client";

import { create } from "zustand";
import { Task, SubTask, Tag } from "@/types";
import { localTasks, localTags, localUser } from "@/lib/local-store";

interface TaskFilters {
  status: string;
  priority: string;
  category: string;
  search: string;
  tagIds: string[];
}

interface TaskStore {
  tasks: Task[];
  tags: Tag[];
  filters: TaskFilters;
  isLoading: boolean;
  error: string | null;

  // Actions
  fetchTasks: () => Promise<void>;
  fetchTags: () => Promise<void>;
  createTask: (task: Partial<Task>, tagIds?: string[]) => Promise<Task | null>;
  updateTask: (id: string, updates: Partial<Task>, tagIds?: string[]) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  toggleTask: (id: string) => Promise<void>;
  reorderTasks: (tasks: Task[]) => Promise<void>;
  createTag: (tag: Partial<Tag>) => Promise<Tag | null>;
  deleteTag: (id: string) => Promise<void>;
  createSubTask: (taskId: string, title: string) => Promise<SubTask | null>;
  toggleSubTask: (subtaskId: string, taskId: string, completed: boolean) => Promise<void>;
  deleteSubTask: (id: string, taskId: string) => Promise<void>;
  setFilters: (filters: Partial<TaskFilters>) => void;
  clearFilters: () => void;
  getFilteredTasks: () => Task[];
  // Realtime stubs (no-op in localStorage mode)
  subscribeToRealtime: () => void;
  unsubscribeFromRealtime: () => void;
}

function uuid() {
  return crypto.randomUUID();
}

function now() {
  return new Date().toISOString();
}

export const useTaskStore = create<TaskStore>((set, get) => ({
  tasks: [],
  tags: [],
  filters: { status: "all", priority: "all", category: "all", search: "", tagIds: [] },
  isLoading: false,
  error: null,

  fetchTasks: async () => {
    set({ isLoading: true, error: null });
    const tasks: Task[] = localTasks.get();
    set({ tasks, isLoading: false });
  },

  fetchTags: async () => {
    const tags: Tag[] = localTags.get();
    set({ tags });
  },

  createTask: async (task, tagIds = []) => {
    const user = localUser.get();
    if (!user) return null;

    const allTags: Tag[] = localTags.get();
    const tags = allTags.filter((t) => tagIds.includes(t.id));

    const newTask: Task = {
      id: uuid(),
      user_id: user.id,
      title: task.title || "",
      description: task.description ?? null,
      status: task.status || "pending",
      priority: task.priority || "medium",
      category: task.category || "personal",
      due_date: task.due_date ?? null,
      reminder_at: task.reminder_at ?? null,
      order_index: get().tasks.length,
      completed_at: null,
      created_at: now(),
      updated_at: now(),
      tags,
      subtasks: [],
    };

    const tasks = [...get().tasks, newTask];
    localTasks.set(tasks);
    set({ tasks });
    return newTask;
  },

  updateTask: async (id, updates, tagIds) => {
    const allTags: Tag[] = localTags.get();
    const tasks = get().tasks.map((t) => {
      if (t.id !== id) return t;
      const tags = tagIds !== undefined ? allTags.filter((tg) => tagIds.includes(tg.id)) : t.tags;
      return { ...t, ...updates, tags, updated_at: now() };
    });
    localTasks.set(tasks);
    set({ tasks });
  },

  deleteTask: async (id) => {
    const tasks = get().tasks.filter((t) => t.id !== id);
    localTasks.set(tasks);
    set({ tasks });
  },

  toggleTask: async (id) => {
    const tasks = get().tasks.map((t) => {
      if (t.id !== id) return t;
      const isCompleted = t.status === "completed";
      return {
        ...t,
        status: isCompleted ? "pending" : "completed",
        completed_at: isCompleted ? null : now(),
        updated_at: now(),
      } as Task;
    });
    localTasks.set(tasks);
    set({ tasks });
  },

  reorderTasks: async (tasks) => {
    const reordered = tasks.map((t, i) => ({ ...t, order_index: i }));
    localTasks.set(reordered);
    set({ tasks: reordered });
  },

  createTag: async (tag) => {
    const user = localUser.get();
    if (!user) return null;
    const newTag: Tag = {
      id: uuid(),
      user_id: user.id,
      name: tag.name || "",
      color: tag.color || "#6366f1",
    };
    const tags = [...get().tags, newTag];
    localTags.set(tags);
    set({ tags });
    return newTag;
  },

  deleteTag: async (id) => {
    const tags = get().tags.filter((t) => t.id !== id);
    localTags.set(tags);
    // Remove tag from tasks
    const tasks = get().tasks.map((t) => ({ ...t, tags: t.tags?.filter((tg) => tg.id !== id) }));
    localTasks.set(tasks);
    set({ tags, tasks });
  },

  createSubTask: async (taskId, title) => {
    const newSub: SubTask = {
      id: uuid(),
      task_id: taskId,
      title,
      completed: false,
      order_index: 0,
      created_at: now(),
    };
    const tasks = get().tasks.map((t) =>
      t.id === taskId ? { ...t, subtasks: [...(t.subtasks || []), newSub] } : t
    );
    localTasks.set(tasks);
    set({ tasks });
    return newSub;
  },

  toggleSubTask: async (subtaskId, taskId, completed) => {
    const tasks = get().tasks.map((t) =>
      t.id === taskId
        ? { ...t, subtasks: t.subtasks?.map((s) => s.id === subtaskId ? { ...s, completed } : s) }
        : t
    );
    localTasks.set(tasks);
    set({ tasks });
  },

  deleteSubTask: async (id, taskId) => {
    const tasks = get().tasks.map((t) =>
      t.id === taskId ? { ...t, subtasks: t.subtasks?.filter((s) => s.id !== id) } : t
    );
    localTasks.set(tasks);
    set({ tasks });
  },

  setFilters: (filters) => set((state) => ({ filters: { ...state.filters, ...filters } })),
  clearFilters: () => set({ filters: { status: "all", priority: "all", category: "all", search: "", tagIds: [] } }),

  subscribeToRealtime: () => { /* no-op in localStorage mode */ },
  unsubscribeFromRealtime: () => { /* no-op in localStorage mode */ },

  getFilteredTasks: () => {
    const { tasks, filters } = get();
    return tasks.filter((task) => {
      if (filters.status !== "all" && task.status !== filters.status) return false;
      if (filters.priority !== "all" && task.priority !== filters.priority) return false;
      if (filters.category !== "all" && task.category !== filters.category) return false;
      if (filters.search && !task.title.toLowerCase().includes(filters.search.toLowerCase()) &&
        !task.description?.toLowerCase().includes(filters.search.toLowerCase())) return false;
      if (filters.tagIds.length > 0) {
        const taskTagIds = task.tags?.map((t) => t.id) || [];
        if (!filters.tagIds.some((id) => taskTagIds.includes(id))) return false;
      }
      return true;
    });
  },
}));
