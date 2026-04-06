"use client";

import { useState } from "react";
import { localUser } from "@/lib/local-store";
import { useTheme } from "@/components/providers/ThemeProvider";
import { Settings, Sun, Moon, Monitor, User, Send, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import toast from "react-hot-toast";

const BOT_USERNAME = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME ?? "";

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

      {/* Telegram Integration */}
      <div className="card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Send className="w-4 h-4 text-secondary-fg" />
          <h2 className="font-semibold text-base-fg">Telegram Bot</h2>
        </div>

        {BOT_USERNAME ? (
          <>
            <p className="text-sm text-secondary-fg">
              Use the TaskFlow bot on Telegram to add tasks, set reminders, and check
              your task list — all without opening the web app.
            </p>

            <a
              href={`https://t.me/${BOT_USERNAME}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 btn-primary"
            >
              <ExternalLink className="w-4 h-4" />
              Open @{BOT_USERNAME} on Telegram
            </a>

            <div className="bg-secondary/50 rounded-xl p-3 space-y-1 text-xs text-secondary-fg">
              <p className="font-medium text-base-fg text-sm mb-2">Available commands:</p>
              <p><code className="bg-base rounded px-1 py-0.5">/tasks</code> — list your pending tasks</p>
              <p><code className="bg-base rounded px-1 py-0.5">/done 2</code> — mark task #2 complete</p>
              <p className="pt-1">Or just <strong>send any text</strong> to create a task instantly.</p>
              <p className="pt-1 text-muted-fg">
                Smart format: <code className="bg-base rounded px-1 py-0.5">
                  Buy groceries tomorrow at 6pm #personal !high
                </code>
              </p>
            </div>
          </>
        ) : (
          <p className="text-sm text-secondary-fg">
            Telegram bot not configured yet. Add{" "}
            <code className="bg-secondary rounded px-1 py-0.5 text-xs">
              NEXT_PUBLIC_TELEGRAM_BOT_USERNAME
            </code>{" "}
            to GitHub Secrets and redeploy to enable this feature.
          </p>
        )}
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
