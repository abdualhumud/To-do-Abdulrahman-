/**
 * local-store.ts
 * Thin localStorage wrappers that replace Supabase for the "no-database" mode.
 * All data is stored in the user's browser only.
 */

export interface LocalUser {
  id: string;
  name: string;
  email: string;
}

// ─── Storage keys ─────────────────────────────────────────────────────────────
const K = {
  user: "tf_user",
  tasks: "tf_tasks",
  tags: "tf_tags",
  habits: "tf_habits",
  completions: "tf_habit_completions",
} as const;

// ─── Generic helpers ──────────────────────────────────────────────────────────
function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(key, JSON.stringify(value));
}

// ─── Domain helpers ───────────────────────────────────────────────────────────
export const localUser = {
  get: (): LocalUser | null => read<LocalUser | null>(K.user, null),
  set: (u: LocalUser) => write(K.user, u),
  clear: () => typeof window !== "undefined" && localStorage.removeItem(K.user),
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const localTasks = {
  get: () => read<any[]>(K.tasks, []),
  set: (v: any[]) => write(K.tasks, v),
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const localTags = {
  get: () => read<any[]>(K.tags, []),
  set: (v: any[]) => write(K.tags, v),
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const localHabits = {
  get: () => read<any[]>(K.habits, []),
  set: (v: any[]) => write(K.habits, v),
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const localCompletions = {
  get: () => read<any[]>(K.completions, []),
  set: (v: any[]) => write(K.completions, v),
};
