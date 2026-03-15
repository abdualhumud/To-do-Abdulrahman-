"use client";

import { useEffect, useState } from "react";
import { useTaskStore } from "@/store/useTaskStore";
import { TaskList } from "@/components/tasks/TaskList";
import { TaskModal } from "@/components/tasks/TaskModal";
import { FilterBar } from "@/components/tasks/FilterBar";
import { StatsCards } from "@/components/dashboard/StatsCards";
import { PomodoroTimer } from "@/components/pomodoro/PomodoroTimer";
import { SendReportButton } from "@/components/dashboard/SendReportButton";
import { Plus, Timer } from "lucide-react";
import { Task } from "@/types";

export default function DashboardPage() {
  const { fetchTasks, fetchTags } = useTaskStore();
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [showPomodoro, setShowPomodoro] = useState(false);

  const { subscribeToRealtime, unsubscribeFromRealtime } = useTaskStore();

  useEffect(() => {
    fetchTasks();
    fetchTags();
    subscribeToRealtime();
    // Keyboard shortcut: N = new task
    function handleKey(e: KeyboardEvent) {
      if (e.key === "n" && !e.ctrlKey && !e.metaKey && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        setShowTaskModal(true);
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("keydown", handleKey);
      unsubscribeFromRealtime();
    };
  }, [fetchTasks, fetchTags, subscribeToRealtime, unsubscribeFromRealtime]);

  function handleEditTask(task: Task) {
    setEditingTask(task);
    setShowTaskModal(true);
  }

  function handleCloseModal() {
    setShowTaskModal(false);
    setEditingTask(null);
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-20 md:pb-6">
      {/* Stats */}
      <StatsCards />

      {/* Action Bar */}
      <div className="flex items-center justify-between gap-4">
        <FilterBar />
        <div className="flex items-center gap-2 flex-shrink-0">
          <SendReportButton />
          <button
            onClick={() => setShowPomodoro(!showPomodoro)}
            className="btn-secondary"
            title="Toggle Pomodoro Timer"
          >
            <Timer className="w-4 h-4" />
            <span className="hidden sm:block">Pomodoro</span>
          </button>
          <button onClick={() => setShowTaskModal(true)} className="btn-primary">
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
