"use client";

import { useTaskStore } from "@/store/useTaskStore";
import { TaskCard } from "./TaskCard";
import { Task } from "@/types";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { CheckCircle2, Inbox } from "lucide-react";

interface TaskListProps {
  onEditTask: (task: Task) => void;
}

export function TaskList({ onEditTask }: TaskListProps) {
  const { getFilteredTasks, reorderTasks, filters } = useTaskStore();
  const tasks = getFilteredTasks();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = tasks.findIndex((t) => t.id === active.id);
    const newIndex = tasks.findIndex((t) => t.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(tasks, oldIndex, newIndex);
    reorderTasks(reordered);
  }

  if (tasks.length === 0) {
    const hasFilters =
      filters.status !== "all" || filters.priority !== "all" || filters.category !== "all" || filters.search;
    return (
      <div className="card p-16 flex flex-col items-center justify-center text-center">
        {hasFilters ? (
          <>
            <div className="w-16 h-16 bg-secondary rounded-2xl flex items-center justify-center mb-4">
              <CheckCircle2 className="w-8 h-8 text-muted-fg" />
            </div>
            <h3 className="font-semibold text-base-fg mb-1">No tasks match your filters</h3>
            <p className="text-secondary-fg text-sm">Try adjusting your search or filters</p>
          </>
        ) : (
          <>
            <div className="w-16 h-16 bg-accent rounded-2xl flex items-center justify-center mb-4">
              <Inbox className="w-8 h-8 text-primary" />
            </div>
            <h3 className="font-semibold text-base-fg mb-1">No tasks yet</h3>
            <p className="text-secondary-fg text-sm">Press <kbd className="bg-secondary px-1.5 py-0.5 rounded text-xs font-mono">N</kbd> or click &ldquo;New Task&rdquo; to get started</p>
          </>
        )}
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
      modifiers={[restrictToVerticalAxis]}
    >
      <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <div className="space-y-2">
          {tasks.map((task) => (
            <TaskCard key={task.id} task={task} onEdit={onEditTask} />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
