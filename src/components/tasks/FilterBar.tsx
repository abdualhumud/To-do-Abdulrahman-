"use client";

import { useTaskStore } from "@/store/useTaskStore";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { useState } from "react";

const STATUS_OPTIONS = ["all", "pending", "in_progress", "completed", "cancelled"];
const PRIORITY_OPTIONS = ["all", "urgent", "high", "medium", "low"];
const CATEGORY_OPTIONS = ["all", "work", "personal", "health", "learning", "finance", "social", "other"];

export function FilterBar() {
  const { filters, setFilters, clearFilters } = useTaskStore();
  const [showFilters, setShowFilters] = useState(false);

  const hasActiveFilters =
    filters.status !== "all" ||
    filters.priority !== "all" ||
    filters.category !== "all" ||
    filters.search !== "";

  return (
    <div className="flex-1 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-fg" />
          <input
            type="text"
            value={filters.search}
            onChange={(e) => setFilters({ search: e.target.value })}
            className="input-base pl-9 h-9 py-0"
            placeholder="Search tasks..."
          />
          {filters.search && (
            <button
              onClick={() => setFilters({ search: "" })}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-fg hover:text-base-fg"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Filter toggle */}
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`btn-secondary h-9 px-3 relative ${showFilters ? "bg-accent text-accent-fg" : ""}`}
        >
          <SlidersHorizontal className="w-4 h-4" />
          {hasActiveFilters && (
            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-primary rounded-full" />
          )}
        </button>

        {hasActiveFilters && (
          <button onClick={clearFilters} className="text-xs text-muted-fg hover:text-base-fg flex items-center gap-1">
            <X className="w-3 h-3" /> Clear
          </button>
        )}
      </div>

      {showFilters && (
        <div className="flex flex-wrap gap-2 animate-slide-up">
          <select
            value={filters.status}
            onChange={(e) => setFilters({ status: e.target.value })}
            className="input-base h-8 py-0 text-xs w-auto pr-7"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{s === "all" ? "All Status" : s.replace("_", " ")}</option>
            ))}
          </select>

          <select
            value={filters.priority}
            onChange={(e) => setFilters({ priority: e.target.value })}
            className="input-base h-8 py-0 text-xs w-auto pr-7"
          >
            {PRIORITY_OPTIONS.map((p) => (
              <option key={p} value={p}>{p === "all" ? "All Priority" : p}</option>
            ))}
          </select>

          <select
            value={filters.category}
            onChange={(e) => setFilters({ category: e.target.value })}
            className="input-base h-8 py-0 text-xs w-auto pr-7"
          >
            {CATEGORY_OPTIONS.map((c) => (
              <option key={c} value={c}>{c === "all" ? "All Category" : c}</option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
