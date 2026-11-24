"use client";

import { create } from "zustand";
import { Task, SubTask, Tag } from "@/types";
import { localTasks, localTags, localUser, hydrateLocalStore } from "@/lib/local-store";

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
  createTasks: (items: Partial<Task>[]) => Promise<Task[]>;
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
    await hydrateLocalStore();
    // Read the cache in the same tick as set(): a read taken before an await could be
    // stale by the time it lands and would overwrite a task created in between.
    const tasks: Task[] = localTasks.get();
    set({ tasks, isLoading: false });
  },

  fetchTags: async () => {
    await hydrateLocalStore();
    const tags: Tag[] = localTags.get();
    set({ tags });
  },

  createTask: async (task, tagIds = []) => {
    const allTags: Tag[] = localTags.get();
    const tags = allTags.filter((t) => tagIds.includes(t.id));
    const [created] = await get().createTasks([{ ...task, tags }]);
    return created ?? null;
  },

  // Builds on the persisted list (not the possibly-not-yet-loaded UI state) so a
  // capture that fires right after page load can never overwrite existing tasks.
  createTasks: async (items) => {
    await hydrateLocalStore();
    const user = localUser.get();
    if (!user) return [];

    const base: Task[] = localTasks.get();
    // A caller may supply a deterministic id (Telegram inbox) so two synced devices collecting the
    // same message produce ONE task; an id that already exists is skipped.
    const have = new Set(base.map((t) => t.id));
    const created: Task[] = items
      .filter((item) => item.title?.trim() && !(item.id && have.has(item.id)))
      .map((item, i) => ({
        id: item.id && /^[A-Za-z0-9_-]{1,64}$/.test(item.id) ? item.id : uuid(),
        user_id: user.id,
        title: item.title!.trim().slice(0, 1000),
        description: item.description ?? null,
        status: item.status || "pending",
        priority: item.priority || "medium",
        category: item.category || "personal",
        due_date: item.due_date ?? null,
        reminder_at: item.reminder_at ?? null,
        repeat: item.repeat ?? "none",
        reminder_channels: item.reminder_channels ?? [],
        order_index: base.length + i,
        completed_at: null,
        created_at: now(),
        updated_at: now(),
        tags: item.tags ?? [],
        subtasks: [],
      }));
    if (created.length === 0) return [];

    const tasks = [...base, ...created];
    localTasks.set(tasks);
    set({ tasks });
    return created;
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

  // `reordered` may be a filtered subset: place it back into the slots the subset
  // occupied so tasks hidden by the current filter are never dropped.
  reorderTasks: async (reordered) => {
    const all = get().tasks;
    const ids = new Set(reordered.map((t) => t.id));
    const slots = all.flatMap((t, i) => (ids.has(t.id) ? [i] : []));
    const next = [...all];
    slots.forEach((slot, k) => {
      next[slot] = reordered[k];
    });
    const tasks = next.map((t, i) => ({ ...t, order_index: i }));
    localTasks.set(tasks);
    set({ tasks });
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
      if (filters.search &&
        !task.title.toLowerCase().includes(filters.search.toLowerCase()) &&
        !(task.description?.toLowerCase().includes(filters.search.toLowerCase()) ?? false)) return false;
      if (filters.tagIds.length > 0) {
        const taskTagIds = task.tags?.map((t) => t.id) || [];
        if (!filters.tagIds.some((id) => taskTagIds.includes(id))) return false;
      }
      return true;
    });
  },
}));
