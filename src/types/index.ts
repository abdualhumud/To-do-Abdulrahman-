export type Priority = "low" | "medium" | "high" | "urgent";
export type TaskStatus = "pending" | "in_progress" | "completed" | "cancelled";
export type Category = "work" | "personal" | "health" | "learning" | "finance" | "social" | "other";

export interface Tag {
  id: string;
  name: string;
  color: string;
  user_id: string;
}

export interface SubTask {
  id: string;
  task_id: string;
  title: string;
  completed: boolean;
  order_index: number;
  created_at: string;
}

export interface Task {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: Priority;
  category: Category;
  due_date: string | null;
  reminder_at: string | null;
  order_index: number;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  tags?: Tag[];
  subtasks?: SubTask[];
  task_tags?: { tag: Tag }[];
}

export interface Habit {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  icon: string;
  color: string;
  frequency: "daily" | "weekly";
  target_count: number;
  created_at: string;
  completions?: HabitCompletion[];
}

export interface HabitCompletion {
  id: string;
  habit_id: string;
  user_id: string;
  completed_at: string;
  notes: string | null;
}

export interface UserProfile {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  timezone: string;
  email_reports_enabled: boolean;
  report_time: string;
  created_at: string;
}

export interface DailyReport {
  completedToday: Task[];
  pendingTomorrow: Task[];
  overdueTask: Task[];
  productivityScore: number;
  totalTasks: number;
  streakDays: number;
}

export interface PomodoroSession {
  id: string;
  task_id: string | null;
  duration: number;
  type: "work" | "short_break" | "long_break";
  completed: boolean;
  started_at: string;
  ended_at: string | null;
}
