"use client";

import { useRouter, usePathname } from "next/navigation";
import { useTheme } from "@/components/providers/ThemeProvider";
import { Sun, Moon, LogOut, AlertTriangle, X, Search } from "lucide-react";
import toast from "react-hot-toast";
import { useState } from "react";
import { localUser, type LocalUser } from "@/lib/local-store";
import { useTaskStore } from "@/store/useTaskStore";

interface HeaderProps {
  user: LocalUser;
}

const PAGE_TITLES: Record<string, string> = {
  "/dashboard":  "Dashboard",
  "/analytics":  "Analytics",
  "/habits":     "Habits",
  "/capture":    "Add from anywhere",
  "/settings":   "Settings",
};

export function Header({ user }: HeaderProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { resolvedTheme, setTheme } = useTheme();
  const { setFilters } = useTaskStore();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchVal, setSearchVal] = useState("");

  const pageTitle = Object.entries(PAGE_TITLES).find(([k]) => pathname === k || pathname.startsWith(k + "/"))?.[1] ?? "TaskFlow";

  function handleLogout() {
    setShowUserMenu(false);
    setShowLogoutConfirm(true);
  }

  function confirmLogout() {
    localUser.clear();
    setShowLogoutConfirm(false);
    toast.success("Signed out — your data stays in this browser");
    router.push("/login");
  }

  function handleSearch(val: string) {
    setSearchVal(val);
    if (pathname !== "/dashboard") router.push("/dashboard");
    setFilters({ search: val });
  }

  function closeSearch() {
    setSearchOpen(false);
    setSearchVal("");
    setFilters({ search: "" });
  }

  const displayName = user.name || user.email?.split("@")[0] || "User";
  const initials = displayName.split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2);
  const greeting = getGreeting();
  const dateStr = new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });

  return (
    <>
      {/* Logout confirmation */}
      {showLogoutConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-fade-in">
          <div className="bg-card border border-base rounded-2xl shadow-lg p-6 max-w-sm w-full mx-4 animate-scale-in">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-danger" />
              </div>
              <div className="flex-1">
                <h2 className="font-semibold text-base-fg">Sign out?</h2>
                <p className="text-sm text-secondary-fg mt-1">
                  Your tasks and data stay saved in this browser. Only your session is cleared.
                </p>
              </div>
              <button onClick={() => setShowLogoutConfirm(false)} className="text-muted-fg hover:text-base-fg transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowLogoutConfirm(false)} className="btn-secondary px-4 py-2 text-sm">
                Cancel
              </button>
              <button
                onClick={confirmLogout}
                className="flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700 active:bg-red-800 transition-colors"
              >
                <LogOut className="w-4 h-4" />
                Sign Out
              </button>
            </div>
          </div>
        </div>
      )}

      <header className="h-16 border-b border-base bg-card/90 glass flex items-center justify-between px-4 md:px-6 gap-4 sticky top-0 z-30">
        {/* Left: title / greeting */}
        <div className="flex-1 min-w-0">
          {searchOpen ? (
            <div className="flex items-center gap-2 animate-slide-up">
              <Search className="w-4 h-4 text-muted-fg flex-shrink-0" />
              <input
                autoFocus
                type="text"
                value={searchVal}
                onChange={(e) => handleSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Escape" && closeSearch()}
                placeholder="Search tasks…"
                className="flex-1 bg-transparent text-sm text-base-fg outline-none placeholder:text-muted-fg"
              />
              <button onClick={closeSearch} className="text-muted-fg hover:text-base-fg flex-shrink-0">
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="animate-fade-in">
              <p className="text-xs text-muted-fg hidden md:block">{dateStr}</p>
              <h1 className="text-sm font-bold text-base-fg leading-tight">
                {pathname === "/dashboard"
                  ? `${greeting}, ${displayName.split(" ")[0]}! 👋`
                  : pageTitle}
              </h1>
            </div>
          )}
        </div>

        {/* Right: actions */}
        <div className="flex items-center gap-1.5">
          {/* Search toggle */}
          {!searchOpen && (
            <button
              onClick={() => setSearchOpen(true)}
              className="w-9 h-9 rounded-xl flex items-center justify-center text-secondary-fg hover:bg-secondary hover:text-base-fg transition-all"
              title="Search (press /)"
            >
              <Search className="w-4 h-4" />
            </button>
          )}

          {/* Theme toggle */}
          <button
            onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
            className="w-9 h-9 rounded-xl flex items-center justify-center text-secondary-fg hover:bg-secondary hover:text-base-fg transition-all"
            title="Toggle theme"
          >
            {resolvedTheme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          {/* User avatar / menu */}
          <div className="relative">
            <button
              onClick={() => setShowUserMenu(!showUserMenu)}
              className="flex items-center gap-2 pl-1.5 pr-2.5 py-1.5 rounded-xl hover:bg-secondary transition-colors"
            >
              <div className="w-7 h-7 bg-primary rounded-lg flex items-center justify-center text-xs font-bold text-white shadow-soft">
                {initials}
              </div>
              <span className="text-sm font-medium text-base-fg hidden sm:block">
                {displayName.split(" ")[0]}
              </span>
            </button>

            {showUserMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowUserMenu(false)} />
                <div className="absolute right-0 top-full mt-2 w-52 card shadow-lg z-50 p-1 animate-scale-in">
                  <div className="px-3 py-2.5 border-b border-base mb-1">
                    <p className="text-sm font-semibold text-base-fg truncate">{displayName}</p>
                    {user.email && <p className="text-xs text-muted-fg truncate">{user.email}</p>}
                  </div>
                  <button
                    onClick={handleLogout}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-danger hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors font-medium"
                  >
                    <LogOut className="w-4 h-4" />
                    Sign Out
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>
    </>
  );
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}
