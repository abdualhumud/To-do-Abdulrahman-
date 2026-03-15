"use client";

import { create } from "zustand";
import { Task, SubTask, Tag } from "@/types";
import { createClient } from "@/lib/supabase/client";

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
}

export const useTaskStore = create<TaskStore>((set, get) => ({
  tasks: [],
  tags: [],
  filters: { status: "all", priority: "all", category: "all", search: "", tagIds: [] },
  isLoading: false,
  error: null,

  fetchTasks: async () => {
    const supabase = createClient();
    set({ isLoading: true, error: null });
    try {
      const { data, error } = await supabase
        .from("tasks")
        .select(`
          *,
          task_tags(tag:tags(*)),
          subtasks(*)
        `)
        .order("order_index", { ascending: true })
        .order("created_at", { ascending: false });

      if (error) throw error;
      const tasks = (data || []).map((t) => ({
        ...t,
        tags: t.task_tags?.map((tt: { tag: Tag }) => tt.tag) || [],
        subtasks: t.subtasks?.sort((a: SubTask, b: SubTask) => a.order_index - b.order_index) || [],
      }));
      set({ tasks, isLoading: false });
    } catch (err) {
      set({ error: (err as Error).message, isLoading: false });
    }
  },

  fetchTags: async () => {
    const supabase = createClient();
    const { data } = await supabase.from("tags").select("*").order("name");
    set({ tags: data || [] });
  },

  createTask: async (task, tagIds = []) => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const { data, error } = await supabase
      .from("tasks")
      .insert({ ...task, user_id: user.id })
      .select()
      .single();

    if (error || !data) return null;

    if (tagIds.length > 0) {
      await supabase.from("task_tags").insert(tagIds.map((tag_id) => ({ task_id: data.id, tag_id })));
    }

    await get().fetchTasks();
    return data;
  },

  updateTask: async (id, updates, tagIds) => {
    const supabase = createClient();
    await supabase.from("tasks").update(updates).eq("id", id);

    if (tagIds !== undefined) {
      await supabase.from("task_tags").delete().eq("task_id", id);
      if (tagIds.length > 0) {
        await supabase.from("task_tags").insert(tagIds.map((tag_id) => ({ task_id: id, tag_id })));
      }
    }

    await get().fetchTasks();
  },

  deleteTask: async (id) => {
    const supabase = createClient();
    await supabase.from("tasks").delete().eq("id", id);
    set((state) => ({ tasks: state.tasks.filter((t) => t.id !== id) }));
  },

  toggleTask: async (id) => {
    const task = get().tasks.find((t) => t.id === id);
    if (!task) return;
    const supabase = createClient();
    const isCompleted = task.status === "completed";
    await supabase.from("tasks").update({
      status: isCompleted ? "pending" : "completed",
      completed_at: isCompleted ? null : new Date().toISOString(),
    }).eq("id", id);
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === id
          ? { ...t, status: isCompleted ? "pending" : "completed", completed_at: isCompleted ? null : new Date().toISOString() }
          : t
      ),
    }));
  },

  reorderTasks: async (tasks) => {
    const supabase = createClient();
    set({ tasks });
    const updates = tasks.map((t, i) => ({ id: t.id, order_index: i, user_id: t.user_id, title: t.title, status: t.status, priority: t.priority, category: t.category }));
    await Promise.all(updates.map((u) => supabase.from("tasks").update({ order_index: u.order_index }).eq("id", u.id)));
  },

  createTag: async (tag) => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data, error } = await supabase.from("tags").insert({ ...tag, user_id: user.id }).select().single();
    if (error || !data) return null;
    set((state) => ({ tags: [...state.tags, data] }));
    return data;
  },

  deleteTag: async (id) => {
    const supabase = createClient();
    await supabase.from("tags").delete().eq("id", id);
    set((state) => ({ tags: state.tags.filter((t) => t.id !== id) }));
  },

  createSubTask: async (taskId, title) => {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("subtasks")
      .insert({ task_id: taskId, title, order_index: 0 })
      .select()
      .single();
    if (error || !data) return null;
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === taskId ? { ...t, subtasks: [...(t.subtasks || []), data] } : t
      ),
    }));
    return data;
  },

  toggleSubTask: async (subtaskId, taskId, completed) => {
    const supabase = createClient();
    await supabase.from("subtasks").update({ completed }).eq("id", subtaskId);
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === taskId
          ? { ...t, subtasks: t.subtasks?.map((s) => s.id === subtaskId ? { ...s, completed } : s) }
          : t
      ),
    }));
  },

  deleteSubTask: async (id, taskId) => {
    const supabase = createClient();
    await supabase.from("subtasks").delete().eq("id", id);
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === taskId ? { ...t, subtasks: t.subtasks?.filter((s) => s.id !== id) } : t
      ),
    }));
  },

  setFilters: (filters) => set((state) => ({ filters: { ...state.filters, ...filters } })),
  clearFilters: () => set({ filters: { status: "all", priority: "all", category: "all", search: "", tagIds: [] } }),

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
