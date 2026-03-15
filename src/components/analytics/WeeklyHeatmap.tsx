"use client";

import { useTaskStore } from "@/store/useTaskStore";
import { useMemo } from "react";
import { format, subDays, startOfWeek, eachDayOfInterval } from "date-fns";
import { cn } from "@/lib/utils";

export function WeeklyHeatmap() {
  const { tasks } = useTaskStore();

  const weeks = useMemo(() => {
    const today = new Date();
    const weeks: { date: Date; count: number }[][] = [];

    for (let w = 3; w >= 0; w--) {
      const weekEnd = subDays(today, w * 7);
      const weekStart = startOfWeek(weekEnd, { weekStartsOn: 1 });
      const days = eachDayOfInterval({ start: weekStart, end: subDays(weekEnd, w === 0 ? 0 : 0) }).slice(0, 7);
      weeks.push(
        days.map((date) => {
          const dateStr = format(date, "yyyy-MM-dd");
          const count = tasks.filter((t) => t.completed_at?.startsWith(dateStr)).length;
          return { date, count };
        })
      );
    }
    return weeks;
  }, [tasks]);

  const dayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const maxCount = Math.max(...weeks.flat().map((d) => d.count), 1);

  function getIntensity(count: number) {
    if (count === 0) return "opacity-10";
    const ratio = count / maxCount;
    if (ratio < 0.25) return "opacity-30";
    if (ratio < 0.5) return "opacity-50";
    if (ratio < 0.75) return "opacity-75";
    return "opacity-100";
  }

  return (
    <div className="space-y-3">
      {/* Week labels */}
      <div className="flex gap-2 justify-end text-xs text-muted-fg pr-1">
        {["4 weeks ago", "3 weeks ago", "2 weeks ago", "This week"].map((w) => (
          <div key={w} className="flex-1 text-center hidden sm:block">{w}</div>
        ))}
      </div>

      <div className="flex gap-1.5 sm:gap-2 items-start">
        {/* Day labels */}
        <div className="flex flex-col gap-1.5 sm:gap-2 pt-0.5">
          {dayLabels.map((d) => (
            <div key={d} className="h-8 flex items-center text-xs text-muted-fg w-8">{d}</div>
          ))}
        </div>

        {/* Grid */}
        <div className="flex-1 grid grid-cols-4 gap-1.5 sm:gap-2">
          {weeks.map((week, wi) => (
            <div key={wi} className="flex flex-col gap-1.5 sm:gap-2">
              {week.map((day, di) => (
                <div
                  key={di}
                  title={`${format(day.date, "MMM d")}: ${day.count} tasks completed`}
                  className={cn("h-8 rounded-md bg-primary transition-opacity cursor-default", getIntensity(day.count))}
                />
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-2 justify-end text-xs text-muted-fg">
        <span>Less</span>
        {["opacity-10", "opacity-30", "opacity-50", "opacity-75", "opacity-100"].map((op) => (
          <div key={op} className={cn("w-4 h-4 rounded-sm bg-primary", op)} />
        ))}
        <span>More</span>
      </div>
    </div>
  );
}
