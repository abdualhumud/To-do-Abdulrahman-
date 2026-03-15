"use client";

import { useTaskStore } from "@/store/useTaskStore";
import { useMemo } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { format, subDays } from "date-fns";

export function ProductivityChart() {
  const { tasks } = useTaskStore();

  const data = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const date = subDays(new Date(), 6 - i);
      const dateStr = format(date, "yyyy-MM-dd");
      const completed = tasks.filter((t) => {
        if (!t.completed_at) return false;
        return t.completed_at.startsWith(dateStr);
      }).length;
      const created = tasks.filter((t) => t.created_at.startsWith(dateStr)).length;
      return { day: format(date, "EEE"), completed, created };
    });
  }, [tasks]);

  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={data} margin={{ top: 5, right: 5, bottom: 0, left: -20 }}>
        <defs>
          <linearGradient id="colorCompleted" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="rgb(99,102,241)" stopOpacity={0.3} />
            <stop offset="95%" stopColor="rgb(99,102,241)" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="colorCreated" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="rgb(34,197,94)" stopOpacity={0.3} />
            <stop offset="95%" stopColor="rgb(34,197,94)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--border))" />
        <XAxis dataKey="day" tick={{ fontSize: 12, fill: "rgb(var(--muted-fg))" }} axisLine={false} tickLine={false} />
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
        <Area type="monotone" dataKey="completed" stroke="rgb(99,102,241)" fill="url(#colorCompleted)" strokeWidth={2} name="Completed" dot={{ fill: "rgb(99,102,241)", r: 3 }} />
        <Area type="monotone" dataKey="created" stroke="rgb(34,197,94)" fill="url(#colorCreated)" strokeWidth={2} name="Created" dot={{ fill: "rgb(34,197,94)", r: 3 }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
