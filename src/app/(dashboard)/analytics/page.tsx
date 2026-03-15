"use client";

import { useEffect } from "react";
import { useTaskStore } from "@/store/useTaskStore";
import { ProductivityChart } from "@/components/analytics/ProductivityChart";
import { CategoryChart } from "@/components/analytics/CategoryChart";
import { PriorityChart } from "@/components/analytics/PriorityChart";
import { WeeklyHeatmap } from "@/components/analytics/WeeklyHeatmap";
import { BarChart2 } from "lucide-react";

export default function AnalyticsPage() {
  const { fetchTasks } = useTaskStore();

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-20 md:pb-6">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 bg-accent rounded-xl flex items-center justify-center">
          <BarChart2 className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-base-fg">Analytics</h1>
          <p className="text-sm text-secondary-fg">Track your productivity trends</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card p-5 lg:col-span-2">
          <h2 className="font-semibold text-base-fg mb-4">7-Day Completion Trend</h2>
          <ProductivityChart />
        </div>

        <div className="card p-5">
          <h2 className="font-semibold text-base-fg mb-4">Tasks by Category</h2>
          <CategoryChart />
        </div>

        <div className="card p-5">
          <h2 className="font-semibold text-base-fg mb-4">Tasks by Priority</h2>
          <PriorityChart />
        </div>

        <div className="card p-5 lg:col-span-2">
          <h2 className="font-semibold text-base-fg mb-4">Weekly Activity Heatmap</h2>
          <WeeklyHeatmap />
        </div>
      </div>
    </div>
  );
}
