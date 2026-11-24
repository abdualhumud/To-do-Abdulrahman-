"use client";

import { useEffect } from "react";
import { CalendarPlus, Download, ExternalLink, X } from "lucide-react";
import toast from "react-hot-toast";
import type { Task } from "@/types";
import { downloadIcs, outlookUrl, slug, toCalendarItem } from "@/lib/calendar";

/** "Add to calendar" sheet: Apple Calendar / Outlook app via .ics, or Outlook on the web. */
export function CalendarSheet({ task, onClose }: { task: Task; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const available = toCalendarItem(task) !== null;
  const repeating = (task.repeat ?? "none") !== "none";

  function download() {
    downloadIcs([task], `${slug(task.title)}.ics`);
    toast.success("Calendar file ready — open it to add the event");
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-4 animate-fade-in" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Add to calendar" className="bg-card border border-base rounded-2xl shadow-lg w-full max-w-sm p-5 space-y-3 animate-scale-in">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-semibold text-base-fg flex items-center gap-2"><CalendarPlus className="w-4 h-4 text-primary" /> Add to calendar</h2>
            <p className="text-sm text-secondary-fg truncate" dir="auto">{task.title}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-muted-fg hover:text-base-fg"><X className="w-4 h-4" /></button>
        </div>

        {!available ? (
          <p className="text-sm text-warning">Give this task a due date or a reminder time first.</p>
        ) : (
          <div className="space-y-2">
            <button onClick={download} className="w-full btn-secondary justify-start">
              <Download className="w-4 h-4" />
              <span className="text-left">
                <span className="block text-sm font-medium text-base-fg">Apple Calendar · Outlook app</span>
                <span className="block text-xs text-muted-fg">Downloads a .ics file with an alarm</span>
              </span>
            </button>
            {(["office", "live"] as const).map((flavor) => (
              <a key={flavor} href={outlookUrl(task, flavor) ?? "#"} target="_blank" rel="noopener noreferrer" onClick={onClose} className="w-full btn-secondary justify-start">
                <ExternalLink className="w-4 h-4" />
                <span className="text-left">
                  <span className="block text-sm font-medium text-base-fg">{flavor === "office" ? "Outlook on the web (Microsoft 365)" : "Outlook.com (personal)"}</span>
                  <span className="block text-xs text-muted-fg">Opens the new-event form</span>
                </span>
              </a>
            ))}
            {repeating && <p className="text-xs text-muted-fg">Outlook links can&apos;t carry repetition — use the .ics file to keep it repeating.</p>}
            <p className="text-xs text-muted-fg">Want everything kept in sync automatically? Use the subscription link in Settings.</p>
          </div>
        )}
      </div>
    </div>
  );
}
