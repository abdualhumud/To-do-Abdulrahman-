"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CheckCircle, LayoutDashboard, BarChart2, Flame, Settings, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/analytics", label: "Analytics", icon: BarChart2 },
  { href: "/habits", label: "Habits", icon: Flame },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex w-60 bg-card border-r border-base flex-col">
        {/* Logo */}
        <div className="p-5 border-b border-base">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center flex-shrink-0">
              <CheckCircle className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-base text-base-fg">TaskFlow</span>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-3 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150",
                  isActive
                    ? "bg-accent text-accent-fg"
                    : "text-secondary-fg hover:bg-secondary hover:text-base-fg"
                )}
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                {item.label}
                {isActive && (
                  <div className="ml-auto w-1.5 h-1.5 rounded-full bg-primary" />
                )}
              </Link>
            );
          })}
        </nav>

        {/* Bottom hint */}
        <div className="p-4 border-t border-base">
          <div className="bg-accent rounded-xl p-3">
            <p className="text-xs font-semibold text-accent-fg mb-1">Pro Tip</p>
            <p className="text-xs text-secondary-fg">Press <kbd className="bg-secondary px-1 py-0.5 rounded text-xs font-mono">N</kbd> to create a new task instantly.</p>
          </div>
        </div>
      </aside>

      {/* Mobile Bottom Nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 glass border-t border-base">
        <div className="flex">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex-1 flex flex-col items-center gap-1 py-3 text-xs font-medium transition-colors",
                  isActive ? "text-primary" : "text-muted-fg"
                )}
              >
                <Icon className="w-5 h-5" />
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
