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
import { useT } from "@/lib/i18n";

const COLORS = ["#6366f1", "#ec4899", "#14b8a6", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4"];
const CATEGORY_LABELS: Record<string, string> = {
  work: "Work",
  personal: "Personal",
  health: "Health",
  learning: "Learning",
  finance: "Finance",
  social: "Social",
  other: "Other",
};
const CATEGORIES = ["work", "personal", "health", "learning", "finance", "social", "other"];

export function CategoryChart() {
  const t = useT();
  const { tasks } = useTaskStore();

  const data = useMemo(() => {
    return CATEGORIES.map((cat, i) => ({
      name: cat,
      value: tasks.filter((t) => t.category === cat).length,
      color: COLORS[i],
    })).filter((d) => d.value > 0);
  }, [tasks]);

  const shown = data.map((d) => ({ ...d, name: t(CATEGORY_LABELS[d.name]) }));

  if (data.length === 0) {
    return (
      <div className="h-48 flex items-center justify-center text-secondary-fg text-sm">
        {t("No tasks yet. Start adding tasks!")}
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={200}>
      <PieChart>
        <Pie
          data={shown}
          cx="50%"
          cy="50%"
          innerRadius={50}
          outerRadius={80}
          paddingAngle={3}
          dataKey="value"
        >
          {shown.map((entry, index) => (
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
