"use client";

import { useTaskStore } from "@/store/useTaskStore";
import { CheckCircle2, Clock, AlertTriangle, TrendingUp, ArrowUp, ArrowDown, Minus } from "lucide-react";
import { isOverdue, isDueToday } from "@/lib/utils";
import { useT } from "@/lib/i18n";

export function StatsCards() {
  const t = useT();
  const { tasks } = useTaskStore();

  const total = tasks.length;
  const completed = tasks.filter((k) => k.status === "completed").length;
  const pending = tasks.filter((k) => k.status === "pending" || k.status === "in_progress").length;

  const today = new Date();
  const completedToday = tasks.filter((k) => {
    if (k.status !== "completed" || !k.completed_at) return false;
    const d = new Date(k.completed_at);
    return (
      d.getFullYear() === today.getFullYear() &&
      d.getMonth() === today.getMonth() &&
      d.getDate() === today.getDate()
    );
  }).length;

  const overdue = tasks.filter((k) => k.status !== "completed" && isOverdue(k.due_date)).length;
  const dueToday = tasks.filter((k) => k.status !== "completed" && isDueToday(k.due_date)).length;
  const score = total > 0 ? Math.round((completed / total) * 100) : 0;

  const stats = [
    {
      label: t("Completed Today"),
      value: completedToday,
      icon: CheckCircle2,
      color: "text-success",
      bgColor: "rgba(34, 197, 94, 0.12)",
      iconBg: "rgba(34, 197, 94, 0.15)",
      subtitle: t("{n} still pending", { n: pending }),
      trend: completedToday > 0 ? "up" : "neutral",
      progress: null,
    },
    {
      label: t("Due Today"),
      value: dueToday,
      icon: Clock,
      color: "text-primary",
      bgColor: "rgb(var(--accent))",
      iconBg: "rgb(var(--accent))",
      subtitle: total === 1 ? t("{n} total task", { n: total }) : t("{n} total tasks", { n: total }),
      trend: dueToday > 3 ? "down" : "neutral",
      progress: null,
    },
    {
      label: t("Overdue"),
      value: overdue,
      icon: AlertTriangle,
      color: "text-danger",
      bgColor: "rgba(239, 68, 68, 0.08)",
      iconBg: "rgba(239, 68, 68, 0.15)",
      subtitle: overdue > 0 ? t("Needs attention") : t("All on track!"),
      trend: overdue > 0 ? "down" : "up",
      progress: null,
    },
    {
      label: t("Productivity"),
      value: `${score}%`,
      icon: TrendingUp,
      color: "text-warning",
      bgColor: "rgba(245, 158, 11, 0.08)",
      iconBg: "rgba(245, 158, 11, 0.15)",
      subtitle: t("{completed} of {total} done", { completed, total }),
      trend: score >= 70 ? "up" : score >= 40 ? "neutral" : "down",
      progress: score,
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {stats.map((stat) => {
        const Icon = stat.icon;
        const TrendIcon = stat.trend === "up" ? ArrowUp : stat.trend === "down" ? ArrowDown : Minus;
        const trendColor = stat.trend === "up" ? "text-success" : stat.trend === "down" ? "text-danger" : "text-muted-fg";

        return (
          <div
            key={stat.label}
            className="card card-hover p-3 md:p-4 overflow-hidden relative"
          >
            {/* Background tint */}
            <div
              className="absolute inset-0 opacity-40 pointer-events-none rounded-2xl"
              style={{ background: stat.bgColor }}
            />

            <div className="relative">
              <div className="flex items-center md:items-start justify-between mb-1.5 md:mb-3">
                <div
                  className="w-8 h-8 md:w-9 md:h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: stat.iconBg }}
                >
                  <Icon className={`${stat.color}`} style={{ width: "1.125rem", height: "1.125rem" }} />
                </div>
                <TrendIcon className={`w-3.5 h-3.5 mt-1 ${trendColor}`} />
              </div>

              <div className="text-2xl font-bold text-base-fg mb-0.5 tabular-nums">{stat.value}</div>
              <div className="text-xs font-semibold text-base-fg mb-0.5">{stat.label}</div>
              <div className="text-xs text-muted-fg hidden md:block">{stat.subtitle}</div>

              {stat.progress !== null && (
                <div className="mt-3 progress-track">
                  <div
                    className="progress-fill"
                    style={{
                      width: `${stat.progress}%`,
                      background: stat.progress >= 70
                        ? "rgb(var(--success))"
                        : stat.progress >= 40
                        ? "rgb(var(--warning))"
                        : "rgb(var(--danger))",
                    }}
                  />
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
