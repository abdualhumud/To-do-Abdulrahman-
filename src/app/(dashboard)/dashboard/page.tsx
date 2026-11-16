"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTaskStore } from "@/store/useTaskStore";
import { TaskList } from "@/components/tasks/TaskList";
import { TaskModal } from "@/components/tasks/TaskModal";
import { FilterBar } from "@/components/tasks/FilterBar";
import { StatsCards } from "@/components/dashboard/StatsCards";
import { PomodoroTimer } from "@/components/pomodoro/PomodoroTimer";
import { ImportTasksModal } from "@/components/capture/ImportTasksModal";
import { TaskPreviewChips } from "@/components/capture/TaskPreviewChips";
import { parseTaskLine } from "@/lib/task-parser";
import { ClipboardList, Plus, Timer, ChevronDown } from "lucide-react";
import { Task } from "@/types";
import toast from "react-hot-toast";

export default function DashboardPage() {
  const createTasks = useTaskStore((s) => s.createTasks);
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [showPomodoro, setShowPomodoro] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState("");
  const [quickTitle, setQuickTitle] = useState("");
  const quickRef = useRef<HTMLInputElement>(null);

  const parsed = useMemo(() => (quickTitle.trim() ? parseTaskLine(quickTitle) : null), [quickTitle]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const isEditable =
        target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable;
      if (isEditable || e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.key === "n") {
        e.preventDefault();
        setShowTaskModal(true);
      }
      if (e.key === "/") {
        e.preventDefault();
        quickRef.current?.focus();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  async function handleQuickAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!parsed) return;
    setQuickTitle("");
    const [task] = await createTasks([
      { title: parsed.title, priority: parsed.priority, category: parsed.category, due_date: parsed.due_date ?? null },
    ]);
    if (task) toast.success(`Added: ${task.title}`);
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData("text");
    if (/\r?\n/.test(text.trim())) {
      e.preventDefault();
      setImportText(text);
      setShowImport(true);
    }
  }

  function openImport() {
    setImportText("");
    setShowImport(true);
  }

  function handleEditTask(task: Task) {
    setEditingTask(task);
    setShowTaskModal(true);
  }

  function handleCloseModal() {
    setShowTaskModal(false);
    setEditingTask(null);
  }

  return (
    <div className="max-w-5xl mx-auto space-y-5 pb-24 md:pb-8">
      <StatsCards />

      {/* Quick-add */}
      <form onSubmit={handleQuickAdd} className="card p-3 space-y-2">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-accent flex items-center justify-center flex-shrink-0">
            <Plus className="w-4 h-4 text-primary" />
          </div>
          <input
            ref={quickRef}
            type="text"
            value={quickTitle}
            onChange={(e) => setQuickTitle(e.target.value)}
            onPaste={handlePaste}
            dir="auto"
            className="flex-1 bg-transparent text-sm text-base-fg outline-none placeholder:text-muted-fg"
            placeholder="Quick add — try “Call mom tomorrow !high” (press / to focus)"
          />
          {quickTitle && (
            <button type="submit" className="text-xs font-semibold text-primary hover:underline flex-shrink-0">
              Add
            </button>
          )}
        </div>
        {parsed && (parsed.due_date || parsed.priority || parsed.category) && (
          <div className="pl-10 flex items-center gap-2 text-xs text-muted-fg animate-fade-in">
            <span>Will add as</span>
            <TaskPreviewChips task={parsed} />
          </div>
        )}
      </form>

      {/* Action bar */}
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <FilterBar />
        <div className="flex items-center gap-2 flex-shrink-0">
          <button onClick={openImport} className="btn-secondary h-9 px-3 text-sm gap-1.5" title="Import a list from Notes">
            <ClipboardList className="w-4 h-4" />
            <span className="hidden sm:block">Import</span>
          </button>
          <button
            onClick={() => setShowPomodoro(!showPomodoro)}
            className={`btn-secondary h-9 px-3 text-sm gap-1.5 ${showPomodoro ? "bg-accent text-accent-fg border-primary" : ""}`}
            title="Pomodoro Timer"
          >
            <Timer className="w-4 h-4" />
            <span className="hidden sm:block">Pomodoro</span>
            <ChevronDown className={`w-3 h-3 hidden sm:block transition-transform ${showPomodoro ? "rotate-180" : ""}`} />
          </button>
          <button onClick={() => setShowTaskModal(true)} className="btn-primary h-9 px-3.5 text-sm">
            <Plus className="w-4 h-4" />
            <span className="hidden sm:block">New Task</span>
          </button>
        </div>
      </div>

      {showPomodoro && (
        <div className="animate-slide-up">
          <PomodoroTimer />
        </div>
      )}

      <TaskList onEditTask={handleEditTask} />

      {showTaskModal && <TaskModal task={editingTask} onClose={handleCloseModal} />}
      {showImport && <ImportTasksModal initialText={importText} onClose={() => setShowImport(false)} />}
    </div>
  );
}
