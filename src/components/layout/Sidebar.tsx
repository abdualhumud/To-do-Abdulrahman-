"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTaskStore } from "@/store/useTaskStore";
import {
  CheckCircle, LayoutDashboard, BarChart2,
  Flame, Settings, Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { isOverdue, isDueToday } from "@/lib/utils";
import { useT } from "@/lib/i18n";

const navItems = [
  { href: "/dashboard",  label: "Dashboard",  icon: LayoutDashboard },
  { href: "/analytics",  label: "Analytics",  icon: BarChart2 },
  { href: "/habits",     label: "Habits",      icon: Flame },
  { href: "/capture",    label: "Capture",     icon: Zap },
  { href: "/settings",   label: "Settings",    icon: Settings },
];

export function Sidebar() {
  const t = useT();
  const pathname = usePathname();
  const { tasks } = useTaskStore();

  const pendingCount = tasks.filter(
    (t) => t.status === "pending" || t.status === "in_progress"
  ).length;

  const urgentCount = tasks.filter(
    (t) =>
      t.status !== "completed" &&
      (t.priority === "urgent" || isOverdue(t.due_date) || isDueToday(t.due_date))
  ).length;

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex w-60 bg-card border-e border-base flex-col">
        {/* Logo */}
        <div className="p-5 border-b border-base">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center flex-shrink-0 shadow-soft">
              <CheckCircle className="w-5 h-5 text-white" />
            </div>
            <div>
              <span className="font-bold text-base text-base-fg tracking-tight">TaskFlow</span>
              <div className="text-xs text-muted-fg leading-none mt-0.5">{t("Productivity Hub")}</div>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
            const showBadge = item.href === "/dashboard" && pendingCount > 0;
            const showUrgent = item.href === "/dashboard" && urgentCount > 0;

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 group",
                  isActive
                    ? "bg-accent text-accent-fg shadow-soft"
                    : "text-secondary-fg hover:bg-secondary hover:text-base-fg"
                )}
              >
                <Icon className={cn("w-4 h-4 flex-shrink-0 transition-transform group-hover:scale-110", isActive && "text-primary")} />
                <span className="flex-1">{t(item.label)}</span>

                {showUrgent ? (
                  <span className="badge" style={{ background: "rgb(var(--danger))" }}>
                    {urgentCount}
                  </span>
                ) : showBadge ? (
                  <span className="badge">{pendingCount > 99 ? "99+" : pendingCount}</span>
                ) : isActive ? (
                  <div className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />
                ) : null}
              </Link>
            );
          })}
        </nav>

        {/* Keyboard shortcut hint */}
        <div className="p-4 border-t border-base">
          <div className="bg-accent rounded-xl p-3 space-y-1.5">
            <p className="text-xs font-semibold text-accent-fg">{t("Keyboard Shortcuts")}</p>
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <p className="text-xs text-secondary-fg">{t("New task")}</p>
                <kbd className="bg-card border border-base px-1.5 py-0.5 rounded text-xs font-mono text-base-fg">N</kbd>
              </div>
              <div className="flex items-center justify-between">
                <p className="text-xs text-secondary-fg">{t("Quick add")}</p>
                <kbd className="bg-card border border-base px-1.5 py-0.5 rounded text-xs font-mono text-base-fg">/</kbd>
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* Mobile Bottom Nav */}
      <nav aria-label={t("Main navigation")} className="md:hidden fixed bottom-0 inset-x-0 z-50 glass border-t border-base pb-[env(safe-area-inset-bottom)]">
        <div className="flex">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
            const showBadge = item.href === "/dashboard" && urgentCount > 0;

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex-1 min-w-0 flex flex-col items-center justify-center gap-1 pt-2.5 pb-2 min-h-[56px] text-[11px] font-medium transition-colors relative active:bg-secondary/60",
                  isActive ? "text-primary" : "text-muted-fg"
                )}
              >
                <div className="relative">
                  <Icon className="w-[22px] h-[22px]" />
                  {showBadge && (
                    <span className="absolute -top-1.5 -end-1.5 badge" style={{ background: "rgb(var(--danger))", fontSize: "0.55rem", minWidth: "0.9rem", height: "0.9rem" }}>
                      {urgentCount > 9 ? "9+" : urgentCount}
                    </span>
                  )}
                </div>
                {t(item.label)}
                {isActive && <div className="absolute top-0 left-1/2 -translate-x-1/2 w-6 h-0.5 rounded-full bg-primary" />}
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
