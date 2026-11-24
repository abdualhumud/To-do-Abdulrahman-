"use client";

import { useTaskStore } from "@/store/useTaskStore";
import { TaskCard } from "./TaskCard";
import { Task } from "@/types";
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor,
  useSensor, useSensors, DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, sortableKeyboardCoordinates,
  verticalListSortingStrategy, arrayMove,
} from "@dnd-kit/sortable";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { AlertCircle, CheckCircle2, Inbox } from "lucide-react";
import { isOverdue } from "@/lib/utils";
import { useT } from "@/lib/i18n";

interface TaskListProps {
  onEditTask: (task: Task) => void;
}

export function TaskList({ onEditTask }: TaskListProps) {
  const t = useT();
  const { getFilteredTasks, reorderTasks, filters } = useTaskStore();
  const tasks = getFilteredTasks();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // Overdue tasks are shown in their own group, so drag order follows what is on screen.
  const overdueTasks = tasks.filter((t) => t.status !== "completed" && isOverdue(t.due_date));
  const otherTasks = tasks.filter((t) => !(t.status !== "completed" && isOverdue(t.due_date)));
  const displayOrder = [...overdueTasks, ...otherTasks];

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = displayOrder.findIndex((t) => t.id === active.id);
    const newIndex = displayOrder.findIndex((t) => t.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    reorderTasks(arrayMove(displayOrder, oldIndex, newIndex));
  }

  if (tasks.length === 0) {
    const hasFilters =
      filters.status !== "all" ||
      filters.priority !== "all" ||
      filters.category !== "all" ||
      filters.search;

    return (
      <div className="card p-14 flex flex-col items-center justify-center text-center animate-fade-in">
        {hasFilters ? (
          <>
            <div className="w-14 h-14 bg-secondary rounded-2xl flex items-center justify-center mb-4">
              <CheckCircle2 className="w-7 h-7 text-muted-fg" />
            </div>
            <h3 className="font-semibold text-base-fg mb-1">{t("No tasks match your filters")}</h3>
            <p className="text-sm text-secondary-fg">{t("Try adjusting your search or filters")}</p>
          </>
        ) : (
          <>
            <div className="w-14 h-14 bg-accent rounded-2xl flex items-center justify-center mb-4">
              <Inbox className="w-7 h-7 text-primary" />
            </div>
            <h3 className="font-semibold text-base-fg mb-1">{t("No tasks yet")}</h3>
            <p className="text-sm text-secondary-fg">
              {t("Press")}{" "}
              <kbd className="bg-secondary border border-base px-1.5 py-0.5 rounded text-xs font-mono">N</kbd>{" "}
              {t("or click")} <strong>{t("New Task")}</strong> {t("to get started")}
            </p>
          </>
        )}
      </div>
    );
  }

  const hasOverdueGroup = overdueTasks.length > 0;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
      modifiers={[restrictToVerticalAxis]}
    >
      <SortableContext items={displayOrder.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <div className="space-y-4">
          {/* Overdue group */}
          {hasOverdueGroup && (
            <div className="space-y-2 animate-slide-up">
              <div className="flex items-center gap-2 px-1">
                <AlertCircle className="w-3.5 h-3.5 text-danger" />
                <span className="text-xs font-semibold text-danger uppercase tracking-wide">
                  {t("Overdue · {n}", { n: overdueTasks.length })}
                </span>
              </div>
              {overdueTasks.map((task) => (
                <TaskCard key={task.id} task={task} onEdit={onEditTask} />
              ))}
            </div>
          )}

          {/* Other tasks */}
          {otherTasks.length > 0 && (
            <div className="space-y-2">
              {hasOverdueGroup && (
                <div className="flex items-center gap-2 px-1">
                  <span className="text-xs font-semibold text-secondary-fg uppercase tracking-wide">
                    {t("All Tasks · {n}", { n: otherTasks.length })}
                  </span>
                </div>
              )}
              {!hasOverdueGroup && (
                <div className="flex items-center gap-2 px-1">
                  <span className="text-xs font-semibold text-secondary-fg uppercase tracking-wide">
                    {t("Tasks · {n}", { n: tasks.length })}
                  </span>
                </div>
              )}
              {otherTasks.map((task) => (
                <TaskCard key={task.id} task={task} onEdit={onEditTask} />
              ))}
            </div>
          )}
        </div>
      </SortableContext>
    </DndContext>
  );
}
