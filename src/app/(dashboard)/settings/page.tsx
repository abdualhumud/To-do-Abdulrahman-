"use client";

import { useState } from "react";
import { localUser } from "@/lib/local-store";
import { useTheme } from "@/components/providers/ThemeProvider";
import { Settings, Sun, Moon, Monitor, User } from "lucide-react";
import { cn } from "@/lib/utils";
import toast from "react-hot-toast";

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const [name, setName] = useState(() => localUser.get()?.name ?? "");
  const [email, setEmail] = useState(() => localUser.get()?.email ?? "");

  function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    const u = localUser.get();
    if (!u) return;
    localUser.set({ ...u, name: name.trim(), email: email.trim() });
    toast.success("Profile saved!");
  }

  const themeOptions = [
    { value: "light", label: "Light", icon: Sun },
    { value: "dark", label: "Dark", icon: Moon },
    { value: "system", label: "System", icon: Monitor },
  ] as const;

  return (
    <div className="max-w-2xl mx-auto space-y-6 pb-20 md:pb-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 bg-secondary rounded-xl flex items-center justify-center">
          <Settings className="w-5 h-5 text-secondary-fg" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-base-fg">Settings</h1>
          <p className="text-sm text-secondary-fg">Manage your profile and preferences</p>
        </div>
      </div>

      {/* Profile */}
      <div className="card p-5 space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <User className="w-4 h-4 text-secondary-fg" />
          <h2 className="font-semibold text-base-fg">Profile</h2>
        </div>

        <form onSubmit={handleSaveProfile} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-base-fg mb-1.5">Full Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input-base"
              placeholder="Your name"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-base-fg mb-1.5">
              Email <span className="text-muted-fg font-normal">(optional)</span>
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input-base"
              placeholder="you@example.com"
            />
          </div>

          <button type="submit" className="btn-primary">
            Save Profile
          </button>
        </form>
      </div>

      {/* Appearance */}
      <div className="card p-5">
        <div className="flex items-center gap-2 mb-4">
          <Sun className="w-4 h-4 text-secondary-fg" />
          <h2 className="font-semibold text-base-fg">Appearance</h2>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {themeOptions.map((opt) => {
            const Icon = opt.icon;
            return (
              <button
                key={opt.value}
                onClick={() => setTheme(opt.value)}
                className={cn(
                  "flex flex-col items-center gap-2 p-3 rounded-xl border-2 transition-all",
                  theme === opt.value
                    ? "border-primary bg-accent"
                    : "border-base hover:border-primary/50"
                )}
              >
                <Icon
                  className={cn(
                    "w-5 h-5",
                    theme === opt.value ? "text-primary" : "text-secondary-fg"
                  )}
                />
                <span
                  className={cn(
                    "text-sm font-medium",
                    theme === opt.value ? "text-primary" : "text-secondary-fg"
                  )}
                >
                  {opt.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* About */}
      <div className="card p-5">
        <h2 className="font-semibold text-base-fg mb-1">About TaskFlow</h2>
        <p className="text-sm text-secondary-fg">Version 1.0.0 · Local-first mode</p>
        <div className="mt-3 text-xs text-muted-fg space-y-1">
          <p>💾 All data saved locally in your browser</p>
          <p>📊 Real-time analytics and habit tracking</p>
          <p>⏱️ Integrated Pomodoro timer</p>
          <p>🌙 Dark / Light / System theme</p>
        </div>
      </div>
    </div>
  );
}
