import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Date-only strings (yyyy-MM-dd) are local calendar days, not UTC instants. */
export function parseDate(date: Date | string): Date {
  if (typeof date !== "string") return date;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(date);
}

export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "";
  return parseDate(date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function isOverdue(dueDate: string | null | undefined): boolean {
  if (!dueDate) return false;
  return parseDate(dueDate) < new Date(new Date().setHours(0, 0, 0, 0));
}

export function isDueToday(dueDate: string | null | undefined): boolean {
  if (!dueDate) return false;
  const today = new Date();
  const due = parseDate(dueDate);
  return (
    due.getFullYear() === today.getFullYear() &&
    due.getMonth() === today.getMonth() &&
    due.getDate() === today.getDate()
  );
}

export function isDueTomorrow(dueDate: string | null | undefined): boolean {
  if (!dueDate) return false;
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const due = parseDate(dueDate);
  return (
    due.getFullYear() === tomorrow.getFullYear() &&
    due.getMonth() === tomorrow.getMonth() &&
    due.getDate() === tomorrow.getDate()
  );
}

export function calculateProductivityScore(completed: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((completed / total) * 100);
}
