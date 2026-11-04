"use client";

import { useEffect, useState, useRef } from "react";
import { useTaskStore } from "@/store/useTaskStore";
import { TaskList } from "@/components/tasks/TaskList";
import { TaskModal } from "@/components/tasks/TaskModal";
import { FilterBar } from "@/components/tasks/FilterBar";
import { StatsCards } from "@/components/dashboard/StatsCards";
import { PomodoroTimer } from "@/components/pomodoro/PomodoroTimer";
import { Plus, Timer, ChevronDown } from "lucide-react";
import { Task } from "@/types";
import toast from "react-hot-toast";

export default function DashboardPage() {
  const { fetchTasks, fetchTags, createTask, subscribeToRealtime, unsubscribeFromRealtime } = useTaskStore();
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [showPomodoro, setShowPomodoro] = useState(false);
  const [quickTitle, setQuickTitle] = useState("");
  const quickRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchTasks();
    fetchTags();
    subscribeToRealtime();

    function handleKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const isEditable = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable;

      if (e.key === "n" && !e.ctrlKey && !e.metaKey && !isEditable) {
        e.preventDefault();
        setShowTaskModal(true);
      }
      if (e.key === "/" && !e.ctrlKey && !e.metaKey && !isEditable) {
        e.preventDefault();
        quickRef.current?.focus();
      }
    }

    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("keydown", handleKey);
      unsubscribeFromRealtime();
    };
  }, [fetchTasks, fetchTags, subscribeToRealtime, unsubscribeFromRealtime]);

  async function handleQuickAdd(e: React.FormEvent) {
    e.preventDefault();
    const title = quickTitle.trim();
    if (!title) return;
    setQuickTitle("");
    const task = await createTask({ title, priority: "medium", category: "personal", status: "pending" });
    if (task) toast.success(`Task added: ${title}`);
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
      {/* Stats */}
      <StatsCards />

      {/* Quick-add task */}
      <form onSubmit={handleQuickAdd} className="card p-3 flex items-center gap-3">
        <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
          <Plus className="w-4 h-4 text-primary" />
        </div>
        <input
          ref={quickRef}
          type="text"
          value={quickTitle}
          onChange={(e) => setQuickTitle(e.target.value)}
          className="flex-1 bg-transparent text-sm text-base-fg outline-none placeholder:text-muted-fg"
          placeholder='Quick add task… (press / to focus, Enter to save)'
        />
        {quickTitle && (
          <button
            type="submit"
            className="text-xs font-semibold text-primary hover:underline flex-shrink-0"
          >
            Add
          </button>
        )}
      </form>

      {/* Action Bar */}
      <div className="flex items-center justify-between gap-3">
        <FilterBar />
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => setShowPomodoro(!showPomodoro)}
            className={`btn-secondary h-9 px-3 text-sm gap-1.5 ${showPomodoro ? "bg-accent text-accent-fg border-primary/40" : ""}`}
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

      {/* Pomodoro Timer */}
      {showPomodoro && (
        <div className="animate-slide-up">
          <PomodoroTimer />
        </div>
      )}

      {/* Task List */}
      <TaskList onEditTask={handleEditTask} />

      {/* Task Modal */}
      {showTaskModal && (
        <TaskModal task={editingTask} onClose={handleCloseModal} />
      )}
    </div>
  );
}
