"use client";

import { useRouter } from "next/navigation";
import { useTheme } from "@/components/providers/ThemeProvider";
import { Sun, Moon, LogOut, AlertTriangle, X } from "lucide-react";
import toast from "react-hot-toast";
import { useState } from "react";
import { localUser, type LocalUser } from "@/lib/local-store";

interface HeaderProps {
  user: LocalUser;
}

export function Header({ user }: HeaderProps) {
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  function handleLogout() {
    setShowUserMenu(false);
    setShowLogoutConfirm(true);
  }

  function confirmLogout() {
    localUser.clear();
    setShowLogoutConfirm(false);
    toast.success("Logged out — your data remains in this browser");
    router.push("/login");
  }

  const displayName = user.name || user.email?.split("@")[0] || "User";
  const initials = displayName
    .split(" ")
    .map((n: string) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <>
      {/* Logout confirmation dialog */}
      {showLogoutConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-card border border-base rounded-xl shadow-xl p-6 max-w-sm w-full mx-4">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-danger" />
              </div>
              <div>
                <h2 className="font-semibold text-base-fg">Sign out?</h2>
                <p className="text-sm text-secondary-fg mt-1">
                  Your tasks and data stay saved in this browser. Signing out only clears your session.
                </p>
              </div>
              <button onClick={() => setShowLogoutConfirm(false)} className="ml-auto text-muted-fg hover:text-base-fg">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowLogoutConfirm(false)}
                className="btn-secondary px-4 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={confirmLogout}
                className="flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-red-600 text-white hover:bg-red-700 active:bg-red-800 transition-colors"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      )}
    <header className="h-16 border-b border-base bg-card flex items-center justify-between px-6">
      <div>
        <h1 className="text-sm font-semibold text-base-fg hidden md:block">
          {getGreeting()}, {displayName.split(" ")[0]}! 👋
        </h1>
      </div>

      <div className="flex items-center gap-2">
        {/* Theme toggle */}
        <button
          onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
          className="w-9 h-9 rounded-lg flex items-center justify-center text-secondary-fg hover:bg-secondary hover:text-base-fg transition-all"
          title="Toggle theme"
        >
          {resolvedTheme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>

        {/* User menu */}
        <div className="relative">
          <button
            onClick={() => setShowUserMenu(!showUserMenu)}
            className="flex items-center gap-2 pl-2 pr-3 py-1.5 rounded-lg hover:bg-secondary transition-colors"
          >
            <div className="w-7 h-7 bg-primary rounded-lg flex items-center justify-center text-xs font-bold text-white">
              {initials}
            </div>
            <span className="text-sm font-medium text-base-fg hidden sm:block">
              {displayName.split(" ")[0]}
            </span>
          </button>

          {showUserMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowUserMenu(false)} />
              <div className="absolute right-0 top-full mt-2 w-48 card shadow-lg z-50 p-1 animate-fade-in">
                <div className="px-3 py-2 border-b border-base mb-1">
                  <p className="text-sm font-medium text-base-fg truncate">{displayName}</p>
                  {user.email && (
                    <p className="text-xs text-muted-fg truncate">{user.email}</p>
                  )}
                </div>
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-danger hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
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
