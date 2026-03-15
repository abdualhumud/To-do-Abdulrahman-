"use client";

import { useTaskStore } from "@/store/useTaskStore";
import { CheckCircle2, Clock, AlertTriangle, TrendingUp } from "lucide-react";
import { isOverdue, isDueToday } from "@/lib/utils";

export function StatsCards() {
  const { tasks } = useTaskStore();

  const total = tasks.length;
  const completed = tasks.filter((t) => t.status === "completed").length;
  const completedToday = tasks.filter((t) => {
    if (t.status !== "completed" || !t.completed_at) return false;
    const today = new Date();
    const completedDate = new Date(t.completed_at);
    return (
      completedDate.getFullYear() === today.getFullYear() &&
      completedDate.getMonth() === today.getMonth() &&
      completedDate.getDate() === today.getDate()
    );
  }).length;
  const overdue = tasks.filter((t) => t.status !== "completed" && isOverdue(t.due_date)).length;
  const dueToday = tasks.filter((t) => t.status !== "completed" && isDueToday(t.due_date)).length;
  const score = total > 0 ? Math.round((completed / total) * 100) : 0;

  const stats = [
    {
      label: "Completed Today",
      value: completedToday,
      icon: CheckCircle2,
      color: "text-success",
      bg: "rgba(34, 197, 94, 0.1)",
      subtitle: `${completed} total done`,
    },
    {
      label: "Due Today",
      value: dueToday,
      icon: Clock,
      color: "text-primary",
      bg: "rgb(var(--accent))",
      subtitle: `${total} total tasks`,
    },
    {
      label: "Overdue",
      value: overdue,
      icon: AlertTriangle,
      color: "text-danger",
      bg: "rgba(239, 68, 68, 0.1)",
      subtitle: overdue > 0 ? "Needs attention" : "All on track!",
    },
    {
      label: "Productivity",
      value: `${score}%`,
      icon: TrendingUp,
      color: "text-warning",
      bg: "rgba(245, 158, 11, 0.1)",
      subtitle: "Overall score",
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {stats.map((stat) => {
        const Icon = stat.icon;
        return (
          <div key={stat.label} className="card p-4">
            <div className="flex items-start justify-between mb-3">
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center"
                style={{ background: stat.bg }}
              >
                <Icon className={`w-4.5 h-4.5 ${stat.color}`} style={{ width: "1.125rem", height: "1.125rem" }} />
              </div>
            </div>
            <div className="text-2xl font-bold text-base-fg mb-0.5">{stat.value}</div>
            <div className="text-sm font-medium text-base-fg">{stat.label}</div>
            <div className="text-xs text-muted-fg mt-0.5">{stat.subtitle}</div>
          </div>
        );
      })}
    </div>
  );
}
