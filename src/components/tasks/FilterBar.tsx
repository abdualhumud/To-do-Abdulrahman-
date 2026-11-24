"use client";

import { useTaskStore } from "@/store/useTaskStore";
import { Search, X, ChevronDown } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";

const STATUS_OPTIONS   = ["all", "pending", "in_progress", "completed", "cancelled"];
const PRIORITY_OPTIONS = ["all", "urgent", "high", "medium", "low"];
const CATEGORY_OPTIONS = ["all", "work", "personal", "health", "learning", "finance", "social", "other"];

const STATUS_LABEL: Record<string, string> = {
  all: "All", pending: "Pending", in_progress: "In Progress",
  completed: "Done", cancelled: "Cancelled",
};
const PRIORITY_LABEL: Record<string, string> = {
  all: "Any Priority", urgent: "🚨 Urgent", high: "🔴 High",
  medium: "🟡 Medium", low: "🟢 Low",
};
const CATEGORY_LABEL: Record<string, string> = {
  all: "All Categories", work: "💼 Work", personal: "👤 Personal",
  health: "💪 Health", learning: "📚 Learning", finance: "💰 Finance",
  social: "🤝 Social", other: "📌 Other",
};

function FilterSelect({
  value, options, labels, onChange,
}: {
  value: string;
  options: string[];
  labels: Record<string, string>;
  onChange: (v: string) => void;
}) {
  const t = useT();
  const isActive = value !== "all";
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "appearance-none h-8 ps-3 pe-7 text-xs rounded-lg border font-medium outline-none transition-all cursor-pointer",
          isActive
            ? "bg-accent text-accent-fg border-primary/40"
            : "bg-secondary text-secondary-fg border-base hover:border-primary/30"
        )}
      >
        {options.map((o) => (
          <option key={o} value={o}>{t(labels[o] ?? o)}</option>
        ))}
      </select>
      <ChevronDown className="absolute end-2 top-1/2 -translate-y-1/2 w-3 h-3 pointer-events-none text-current opacity-60" />
    </div>
  );
}

export function FilterBar() {
  const t = useT();
  const { filters, setFilters, clearFilters } = useTaskStore();
  const [showFilters, setShowFilters] = useState(false);

  const hasActiveFilters =
    filters.status !== "all" ||
    filters.priority !== "all" ||
    filters.category !== "all" ||
    filters.search !== "";

  const activeFilterCount = [
    filters.status !== "all",
    filters.priority !== "all",
    filters.category !== "all",
  ].filter(Boolean).length;

  return (
    <div className="flex-1 flex flex-col gap-2">
      {/* Search + filter toggle row */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-fg pointer-events-none" />
          <input
            type="text"
            value={filters.search}
            onChange={(e) => setFilters({ search: e.target.value })}
            className="input-base ps-9 h-9 py-0 text-sm"
            placeholder={t("Search tasks…")}
          />
          {filters.search && (
            <button
              onClick={() => setFilters({ search: "" })}
              className="absolute end-2.5 top-1/2 -translate-y-1/2 text-muted-fg hover:text-base-fg transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <button
          onClick={() => setShowFilters(!showFilters)}
          className={cn(
            "btn-secondary h-9 px-3 relative text-xs gap-1.5",
            showFilters && "bg-accent text-accent-fg border-primary/40"
          )}
        >
          {t("Filters")}
          {activeFilterCount > 0 ? (
            <span className="badge" style={{ fontSize: "0.6rem", minWidth: "1rem", height: "1rem" }}>
              {activeFilterCount}
            </span>
          ) : (
            <ChevronDown className={cn("w-3 h-3 transition-transform", showFilters && "rotate-180")} />
          )}
        </button>

        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            className="text-xs text-muted-fg hover:text-danger flex items-center gap-1 transition-colors whitespace-nowrap"
          >
            <X className="w-3 h-3" /> {t("Clear")}
          </button>
        )}
      </div>

      {/* Expanded filter row */}
      {showFilters && (
        <div className="flex flex-wrap gap-2 animate-slide-up">
          <FilterSelect
            value={filters.status}
            options={STATUS_OPTIONS}
            labels={STATUS_LABEL}
            onChange={(v) => setFilters({ status: v })}
          />
          <FilterSelect
            value={filters.priority}
            options={PRIORITY_OPTIONS}
            labels={PRIORITY_LABEL}
            onChange={(v) => setFilters({ priority: v })}
          />
          <FilterSelect
            value={filters.category}
            options={CATEGORY_OPTIONS}
            labels={CATEGORY_LABEL}
            onChange={(v) => setFilters({ category: v })}
          />
        </div>
      )}
    </div>
  );
}
