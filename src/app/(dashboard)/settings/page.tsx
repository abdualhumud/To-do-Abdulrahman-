"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useTheme } from "@/components/providers/ThemeProvider";
import { Settings, Sun, Moon, Monitor, User, Bell, Shield, Loader2, Send, CheckCircle2, Link2Off } from "lucide-react";
import { cn } from "@/lib/utils";
import toast from "react-hot-toast";

interface Profile {
  full_name: string | null;
  email: string;
  email_reports_enabled: boolean;
  report_time: string;
  timezone: string;
  telegram_chat_id: number | null;
}

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [emailReports, setEmailReports] = useState(true);
  const [reportTime, setReportTime] = useState("08:00");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordLoading, setPasswordLoading] = useState(false);
  // Telegram state
  const [telegramChatId, setTelegramChatId] = useState<number | null>(null);
  const [telegramLinkUrl, setTelegramLinkUrl] = useState<string | null>(null);
  const [telegramLoading, setTelegramLoading] = useState(false);

  useEffect(() => {
    async function loadProfile() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase.from("user_profiles").select("*").eq("id", user.id).single();
      if (data) {
        setProfile({ ...data, email: user.email || "" });
        setName(data.full_name || "");
        setEmailReports(data.email_reports_enabled ?? true);
        setReportTime(data.report_time?.slice(0, 5) || "08:00");
        setTelegramChatId(data.telegram_chat_id ?? null);
      }
    }
    loadProfile();
  }, []);

  async function handleSaveProfile() {
    setLoading(true);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const { error } = await supabase.from("user_profiles").upsert({
      id: user.id,
      email: user.email!,
      full_name: name,
      email_reports_enabled: emailReports,
      report_time: reportTime + ":00",
    });

    if (error) { toast.error("Failed to save settings"); }
    else { toast.success("Settings saved!"); }
    setLoading(false);
  }

  async function handleChangePassword() {
    if (!newPassword || newPassword.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    setPasswordLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) { toast.error(error.message); }
    else {
      toast.success("Password updated!");
      setCurrentPassword("");
      setNewPassword("");
    }
    setPasswordLoading(false);
  }

  async function handleConnectTelegram() {
    setTelegramLoading(true);
    setTelegramLinkUrl(null);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setTelegramLoading(false); return; }

    // Generate a secure random token (32 hex chars)
    const tokenBytes = crypto.getRandomValues(new Uint8Array(16));
    const token = Array.from(tokenBytes).map((b) => b.toString(16).padStart(2, "0")).join("");

    const { error } = await supabase
      .from("user_profiles")
      .update({ telegram_link_token: token })
      .eq("id", user.id);

    if (error) {
      toast.error("Failed to generate link");
      setTelegramLoading(false);
      return;
    }

    const botUsername = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME;
    if (!botUsername) {
      toast.error("Bot username not configured (NEXT_PUBLIC_TELEGRAM_BOT_USERNAME)");
      setTelegramLoading(false);
      return;
    }

    setTelegramLinkUrl(`https://t.me/${botUsername}?start=${token}`);
    setTelegramLoading(false);
  }

  async function handleDisconnectTelegram() {
    setTelegramLoading(true);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setTelegramLoading(false); return; }

    const { error } = await supabase
      .from("user_profiles")
      .update({ telegram_chat_id: null, telegram_link_token: null })
      .eq("id", user.id);

    if (error) { toast.error("Failed to disconnect"); }
    else {
      setTelegramChatId(null);
      setTelegramLinkUrl(null);
      toast.success("Telegram disconnected");
    }
    setTelegramLoading(false);
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
          <p className="text-sm text-secondary-fg">Manage your account and preferences</p>
        </div>
      </div>

      {/* Profile */}
      <div className="card p-5 space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <User className="w-4 h-4 text-secondary-fg" />
          <h2 className="font-semibold text-base-fg">Profile</h2>
        </div>

        <div>
          <label className="block text-sm font-medium text-base-fg mb-1.5">Full Name</label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} className="input-base" placeholder="Your name" />
        </div>

        <div>
          <label className="block text-sm font-medium text-base-fg mb-1.5">Email</label>
          <input type="email" value={profile?.email || ""} className="input-base opacity-60" disabled />
          <p className="text-xs text-muted-fg mt-1">Email cannot be changed here</p>
        </div>

        <button onClick={handleSaveProfile} disabled={loading} className="btn-primary">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          {loading ? "Saving..." : "Save Profile"}
        </button>
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
                  theme === opt.value ? "border-primary bg-accent" : "border-base hover:border-primary/50"
                )}
              >
                <Icon className={cn("w-5 h-5", theme === opt.value ? "text-primary" : "text-secondary-fg")} />
                <span className={cn("text-sm font-medium", theme === opt.value ? "text-primary" : "text-secondary-fg")}>
                  {opt.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Email Reports */}
      <div className="card p-5 space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <Bell className="w-4 h-4 text-secondary-fg" />
          <h2 className="font-semibold text-base-fg">Email Reports</h2>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-base-fg">Daily Productivity Digest</p>
            <p className="text-xs text-muted-fg">Get a summary of your daily tasks by email</p>
          </div>
          <button
            onClick={() => setEmailReports(!emailReports)}
            className={cn(
              "relative w-11 h-6 rounded-full transition-colors flex-shrink-0",
              emailReports ? "bg-primary" : "bg-secondary"
            )}
          >
            <span
              className={cn(
                "absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform",
                emailReports ? "translate-x-5" : "translate-x-0"
              )}
            />
          </button>
        </div>

        {emailReports && (
          <div className="animate-slide-up">
            <label className="block text-sm font-medium text-base-fg mb-1.5">Send time</label>
            <input
              type="time"
              value={reportTime}
              onChange={(e) => setReportTime(e.target.value)}
              className="input-base w-auto"
            />
          </div>
        )}

        <button onClick={handleSaveProfile} disabled={loading} className="btn-primary">
          Save Email Settings
        </button>
      </div>

      {/* Telegram Integration */}
      <div className="card p-5 space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <Send className="w-4 h-4 text-secondary-fg" />
          <h2 className="font-semibold text-base-fg">Telegram Integration</h2>
        </div>

        {telegramChatId ? (
          /* ── Connected state ── */
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
              <span className="text-base-fg font-medium">Telegram connected</span>
            </div>
            <p className="text-xs text-muted-fg">
              You can now create tasks by messaging your bot. Send a voice note and it will be transcribed automatically.
            </p>
            <button
              onClick={handleDisconnectTelegram}
              disabled={telegramLoading}
              className="btn-secondary flex items-center gap-1.5 text-sm"
            >
              {telegramLoading
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Link2Off className="w-4 h-4" />}
              Disconnect Telegram
            </button>
          </div>
        ) : (
          /* ── Not connected state ── */
          <div className="space-y-3">
            <p className="text-sm text-secondary-fg">
              Connect your Telegram account to create tasks by text or voice message — with automatic AI transcription.
            </p>
            <ul className="text-xs text-muted-fg space-y-1 list-none">
              <li>📝 Send text like <code className="bg-secondary px-1 rounded">Buy milk tomorrow at 5pm #personal !high</code></li>
              <li>🎤 Send a voice note — the bot transcribes &amp; creates the task</li>
              <li>📋 Use <code className="bg-secondary px-1 rounded">/tasks</code> to list pending tasks</li>
              <li>✅ Use <code className="bg-secondary px-1 rounded">/done N</code> to complete a task</li>
            </ul>

            {!telegramLinkUrl ? (
              <button
                onClick={handleConnectTelegram}
                disabled={telegramLoading}
                className="btn-primary flex items-center gap-1.5"
              >
                {telegramLoading
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <Send className="w-4 h-4" />}
                {telegramLoading ? "Generating link…" : "Connect Telegram"}
              </button>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-secondary-fg">Click the button below to open the bot and complete the link:</p>
                <a
                  href={telegramLinkUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-primary inline-flex items-center gap-1.5"
                >
                  <Send className="w-4 h-4" />
                  Open Telegram Bot
                </a>
                <p className="text-xs text-muted-fg">This link expires once used. Refresh the page after linking.</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Security */}
      <div className="card p-5 space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <Shield className="w-4 h-4 text-secondary-fg" />
          <h2 className="font-semibold text-base-fg">Security</h2>
        </div>

        <div>
          <label className="block text-sm font-medium text-base-fg mb-1.5">New Password</label>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="input-base"
            placeholder="Min. 8 characters"
          />
        </div>

        <button onClick={handleChangePassword} disabled={passwordLoading || !newPassword} className="btn-secondary">
          {passwordLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          {passwordLoading ? "Updating..." : "Update Password"}
        </button>
      </div>

      {/* Data */}
      <div className="card p-5">
        <h2 className="font-semibold text-base-fg mb-1">About TaskFlow</h2>
        <p className="text-sm text-secondary-fg">Version 1.0.0 · Built with Next.js, Supabase & Resend</p>
        <div className="mt-3 text-xs text-muted-fg space-y-1">
          <p>✅ Secure authentication with Supabase</p>
          <p>📧 Daily email reports powered by Resend</p>
          <p>📊 Real-time analytics and habit tracking</p>
          <p>⏱️ Integrated Pomodoro timer</p>
        </div>
      </div>
    </div>
  );
}
