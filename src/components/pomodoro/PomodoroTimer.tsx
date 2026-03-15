"use client";

import { useState, useEffect, useCallback } from "react";
import { Play, Pause, RotateCcw, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import toast from "react-hot-toast";

type TimerMode = "work" | "short_break" | "long_break";

const MODES: Record<TimerMode, { label: string; duration: number; color: string }> = {
  work: { label: "Focus", duration: 25 * 60, color: "rgb(var(--primary))" },
  short_break: { label: "Short Break", duration: 5 * 60, color: "rgb(var(--success))" },
  long_break: { label: "Long Break", duration: 15 * 60, color: "rgb(var(--warning))" },
};

export function PomodoroTimer() {
  const [mode, setMode] = useState<TimerMode>("work");
  const [timeLeft, setTimeLeft] = useState(MODES.work.duration);
  const [running, setRunning] = useState(false);
  const [sessions, setSessions] = useState(0);

  const totalTime = MODES[mode].duration;
  const progress = ((totalTime - timeLeft) / totalTime) * 100;
  const circumference = 2 * Math.PI * 54;

  const handleComplete = useCallback(() => {
    setRunning(false);
    if (mode === "work") setSessions((s) => s + 1);
    toast.success(
      mode === "work" ? "🎉 Focus session done! Take a break." : "⚡ Break done! Back to work.",
      { duration: 5000 }
    );
  }, [mode]);

  useEffect(() => {
    if (!running) return;
    const interval = setInterval(() => {
      setTimeLeft((t) => {
        if (t <= 1) {
          clearInterval(interval);
          handleComplete();
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [running, handleComplete]);

  function handleModeChange(newMode: TimerMode) {
    setMode(newMode);
    setTimeLeft(MODES[newMode].duration);
    setRunning(false);
  }

  function handleToggle() {
    setRunning(!running);
  }

  function handleReset() {
    setTimeLeft(MODES[mode].duration);
    setRunning(false);
  }

  const mins = Math.floor(timeLeft / 60).toString().padStart(2, "0");
  const secs = (timeLeft % 60).toString().padStart(2, "0");

  return (
    <div className="card p-5">
      <div className="flex flex-col sm:flex-row items-center gap-6">
        {/* Mode selector */}
        <div className="flex gap-1.5">
          {(Object.entries(MODES) as [TimerMode, typeof MODES[TimerMode]][]).map(([key, val]) => (
            <button
              key={key}
              onClick={() => handleModeChange(key)}
              className={cn(
                "text-xs px-3 py-1.5 rounded-lg font-medium transition-all",
                mode === key ? "text-white shadow-sm" : "text-secondary-fg hover:bg-secondary"
              )}
              style={mode === key ? { background: val.color } : {}}
            >
              {val.label}
            </button>
          ))}
        </div>

        {/* Timer circle */}
        <div className="relative flex-shrink-0">
          <svg width="128" height="128" viewBox="0 0 128 128">
            <circle cx="64" cy="64" r="54" fill="none" stroke="rgb(var(--border))" strokeWidth="6" />
            <circle
              cx="64"
              cy="64"
              r="54"
              fill="none"
              stroke={MODES[mode].color}
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={circumference - (progress / 100) * circumference}
              transform="rotate(-90 64 64)"
              style={{ transition: "stroke-dashoffset 0.5s ease" }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-2xl font-bold font-mono text-base-fg">{mins}:{secs}</span>
            <span className="text-xs text-muted-fg">{MODES[mode].label}</span>
          </div>
        </div>

        {/* Controls */}
        <div className="flex flex-col items-center gap-3">
          <div className="flex items-center gap-2">
            <button
              onClick={handleReset}
              className="w-9 h-9 rounded-lg flex items-center justify-center text-secondary-fg hover:bg-secondary hover:text-base-fg transition-all"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
            <button
              onClick={handleToggle}
              className="w-12 h-12 rounded-xl text-white flex items-center justify-center transition-all hover:opacity-90 shadow-lg"
              style={{ background: MODES[mode].color }}
            >
              {running ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
            </button>
          </div>

          <div className="text-center">
            <div className="flex items-center gap-1.5 text-sm text-secondary-fg">
              <Zap className="w-4 h-4 text-warning" />
              <span>{sessions} sessions today</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
