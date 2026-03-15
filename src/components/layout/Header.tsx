"use client";

import { useRouter } from "next/navigation";
import { useTheme } from "@/components/providers/ThemeProvider";
import { Sun, Moon, LogOut } from "lucide-react";
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

  function handleLogout() {
    localUser.clear();
    toast.success("Logged out");
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
  );
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}
