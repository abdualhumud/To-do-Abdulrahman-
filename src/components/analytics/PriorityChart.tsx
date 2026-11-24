"use client";

import { useTaskStore } from "@/store/useTaskStore";
import { useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { useT } from "@/lib/i18n";

const PRIORITY_COLORS = {
  urgent: "#ef4444",
  high: "#f59e0b",
  medium: "#6366f1",
  low: "#22c55e",
};

export function PriorityChart() {
  const t = useT();
  const { tasks } = useTaskStore();

  const data = useMemo(() => {
    return (["urgent", "high", "medium", "low"] as const).map((priority) => ({
      name: priority,
      total: tasks.filter((t) => t.priority === priority).length,
      completed: tasks.filter((t) => t.priority === priority && t.status === "completed").length,
      color: PRIORITY_COLORS[priority],
    }));
  }, [tasks]);

  const PRIORITY_LABELS = { urgent: "Urgent", high: "High", medium: "Medium", low: "Low" } as const;
  const shown = data.map((d) => ({ ...d, name: t(PRIORITY_LABELS[d.name]) }));

  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={shown} margin={{ top: 5, right: 5, bottom: 0, left: -20 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--border))" />
        <XAxis dataKey="name" tick={{ fontSize: 12, fill: "rgb(var(--muted-fg))" }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 12, fill: "rgb(var(--muted-fg))" }} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip
          contentStyle={{
            background: "rgb(var(--card))",
            border: "1px solid rgb(var(--border))",
            borderRadius: "0.75rem",
            fontSize: "0.75rem",
            color: "rgb(var(--fg))",
          }}
        />
        <Bar dataKey="total" name={t("Total")} radius={[4, 4, 0, 0]}>
          {shown.map((entry, index) => (
            <Cell key={index} fill={entry.color} opacity={0.8} />
          ))}
        </Bar>
        <Bar dataKey="completed" name={t("Done")} radius={[4, 4, 0, 0]}>
          {shown.map((entry, index) => (
            <Cell key={index} fill={entry.color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
