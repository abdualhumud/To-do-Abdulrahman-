"use client";

import { useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { REPEATS, REPEAT_LABELS, type Repeat } from "../../../telegram-bot/lib/recurrence";
import type { ReminderChannel } from "@/types";
import { cn } from "@/lib/utils";

export interface ReminderValue {
  enabled: boolean;
  at: string; // datetime-local value
  repeat: Repeat;
  channels: ReminderChannel[];
}

const CHANNELS: { id: ReminderChannel; label: string; needsServer: boolean }[] = [
  { id: "inapp", label: "In app", needsServer: false },
  { id: "telegram", label: "Telegram", needsServer: true },
  { id: "email", label: "Email", needsServer: true },
  { id: "push", label: "Phone", needsServer: true },
];

interface Props {
  value: ReminderValue;
  onChange: (next: ReminderValue) => void;
  serverReady: boolean;
  syncOn: boolean;
  /** Called with true when switched on so the parent can propose a time and channels. */
  onToggle: (enabled: boolean) => void;
}

export function ReminderFields({ value, onChange, serverReady, syncOn, onToggle }: Props) {
  const [now] = useState(() => Date.now());
  const inPast = value.enabled && value.repeat === "none" && value.at !== "" && new Date(value.at).getTime() < now;
  const serverChosen = value.channels.some((c) => c !== "inapp");

  function toggleChannel(id: ReminderChannel) {
    const channels = value.channels.includes(id) ? value.channels.filter((c) => c !== id) : [...value.channels, id];
    onChange({ ...value, channels });
  }

  return (
    <div className="rounded-xl border border-base p-3 space-y-3">
      <button
        type="button"
        role="switch"
        aria-checked={value.enabled}
        onClick={() => onToggle(!value.enabled)}
        className="w-full flex items-center justify-between gap-3 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-medium text-base-fg">
          <Bell className="w-4 h-4 text-primary" /> Remind me
        </span>
        <span className={cn("w-9 h-5 rounded-full p-0.5 transition-colors", value.enabled ? "bg-primary" : "bg-secondary")}>
          <span className={cn("block w-4 h-4 rounded-full bg-white shadow transition-transform", value.enabled && "translate-x-4")} />
        </span>
      </button>

      {value.enabled && (
        <div className="space-y-3 animate-slide-up">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-secondary-fg mb-1" htmlFor="reminder-at">When</label>
              <input
                id="reminder-at"
                type="datetime-local"
                value={value.at}
                onChange={(e) => onChange({ ...value, at: e.target.value })}
                className="input-base"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-secondary-fg mb-1" htmlFor="reminder-repeat">Repeat</label>
              <select
                id="reminder-repeat"
                value={value.repeat}
                onChange={(e) => onChange({ ...value, repeat: e.target.value as Repeat })}
                className="input-base"
              >
                {REPEATS.map((r) => (
                  <option key={r} value={r}>{REPEAT_LABELS[r]}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <p className="text-xs font-medium text-secondary-fg mb-1.5">Remind me by</p>
            <div className="flex flex-wrap gap-1.5">
              {CHANNELS.map((c) => {
                const disabled = c.needsServer && !serverReady;
                const on = value.channels.includes(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    disabled={disabled}
                    aria-pressed={on}
                    title={disabled ? "Connect the bot server in Settings to use this" : undefined}
                    onClick={() => toggleChannel(c.id)}
                    className={cn(
                      "text-xs px-3 py-1.5 rounded-full border font-medium transition-all",
                      on ? "bg-accent text-accent-fg border-primary" : "border-base text-secondary-fg hover:border-primary",
                      disabled && "opacity-40 cursor-not-allowed hover:border-base",
                    )}
                  >
                    {c.label}
                  </button>
                );
              })}
            </div>
          </div>

          {inPast && <p className="text-xs text-warning">That time has already passed — pick a future time or a repeat.</p>}
          {!serverReady && (
            <p className="text-xs text-muted-fg">
              Telegram, email and phone reminders arrive even when the app is closed. Set them up in{" "}
              <Link href="/settings" className="text-primary hover:underline">Settings</Link>.
            </p>
          )}
          {serverReady && serverChosen && !syncOn && (
            <p className="text-xs text-warning">
              Turn on “Keep reminders on my server” in{" "}
              <Link href="/settings" className="text-primary hover:underline">Settings</Link>{" "}
              so these are sent while the app is closed.
            </p>
          )}
          {value.channels.length === 0 && <p className="text-xs text-warning">Pick at least one way to be reminded.</p>}
        </div>
      )}
    </div>
  );
}
