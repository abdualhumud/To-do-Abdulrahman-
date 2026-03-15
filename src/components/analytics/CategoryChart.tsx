"use client";

import { useTaskStore } from "@/store/useTaskStore";
import { useMemo } from "react";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

const COLORS = ["#6366f1", "#ec4899", "#14b8a6", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4"];
const CATEGORIES = ["work", "personal", "health", "learning", "finance", "social", "other"];

export function CategoryChart() {
  const { tasks } = useTaskStore();

  const data = useMemo(() => {
    return CATEGORIES.map((cat, i) => ({
      name: cat.charAt(0).toUpperCase() + cat.slice(1),
      value: tasks.filter((t) => t.category === cat).length,
      color: COLORS[i],
    })).filter((d) => d.value > 0);
  }, [tasks]);

  if (data.length === 0) {
    return (
      <div className="h-48 flex items-center justify-center text-secondary-fg text-sm">
        No tasks yet. Start adding tasks!
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={200}>
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          innerRadius={50}
          outerRadius={80}
          paddingAngle={3}
          dataKey="value"
        >
          {data.map((entry, index) => (
            <Cell key={index} fill={entry.color} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{
            background: "rgb(var(--card))",
            border: "1px solid rgb(var(--border))",
            borderRadius: "0.75rem",
            fontSize: "0.75rem",
            color: "rgb(var(--fg))",
          }}
        />
        <Legend
          iconType="circle"
          iconSize={8}
          formatter={(value) => <span style={{ color: "rgb(var(--secondary-fg))", fontSize: "0.75rem" }}>{value}</span>}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
