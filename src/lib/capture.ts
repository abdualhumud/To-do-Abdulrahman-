"use client";

/**
 * capture.ts — add tasks from a link, e.g. from Apple Shortcuts, Notes, a bookmarklet or Siri:
 *
 *   <app>/dashboard/?add=Buy milk tomorrow #personal !high
 *   <app>/dashboard/?add=line one%0Aline two          (one task per line)
 *   optional: &priority=high &due=tomorrow|2026-12-01 &category=work &notes=...
 *
 * If the visitor is not signed in yet the request is parked in sessionStorage and
 * replayed right after sign-in. The URL is cleaned immediately so a reload never
 * adds the task twice.
 */

import type { Task } from "@/types";
import { taskFromParsed } from "@/lib/reminder-fields";
import { useTaskStore } from "@/store/useTaskStore";
import {
  MAX_TASKS_PER_BATCH,
  parseCategory,
  parseDueParam,
  parsePriority,
  parseTasksFromText,
} from "@/lib/task-parser";

const PENDING_KEY = "tf_pending_capture";
const TEXT_PARAMS = ["add", "task", "title", "text"];
const MAX_INPUT = 20_000;

let handled = false;

function paramsFromSearch(search: string): URLSearchParams | null {
  const params = new URLSearchParams(search);
  return TEXT_PARAMS.some((k) => params.get(k)) ? params : null;
}

/** Call before redirecting an anonymous visitor to /login so the capture survives sign-in. */
export function stashCaptureRequest(): void {
  try {
    if (paramsFromSearch(window.location.search)) {
      sessionStorage.setItem(PENDING_KEY, window.location.search);
    }
  } catch {
    /* sessionStorage unavailable */
  }
}

function readRequest(): URLSearchParams | null {
  const fromUrl = paramsFromSearch(window.location.search);
  if (fromUrl) return fromUrl;
  try {
    const stashed = sessionStorage.getItem(PENDING_KEY);
    return stashed ? paramsFromSearch(stashed) : null;
  } catch {
    return null;
  }
}

function clearRequest(): void {
  try {
    sessionStorage.removeItem(PENDING_KEY);
  } catch {
    /* ignore */
  }
  if (paramsFromSearch(window.location.search)) {
    window.history.replaceState(window.history.state, "", window.location.pathname + window.location.hash);
  }
}

export function buildTasksFromParams(params: URLSearchParams): Partial<Task>[] {
  const text = (TEXT_PARAMS.map((k) => params.get(k)).find(Boolean) ?? "").slice(0, MAX_INPUT);
  const priority = parsePriority(params.get("priority"));
  const category = parseCategory(params.get("category"));
  const due = parseDueParam(params.get("due"));
  const notes = params.get("notes")?.trim().slice(0, 5000) || null;

  return parseTasksFromText(text)
    .slice(0, MAX_TASKS_PER_BATCH)
    .map((p) => ({
      ...taskFromParsed({ ...p, due_date: due ?? p.due_date }),
      priority: priority ?? p.priority,
      category: category ?? p.category,
      description: notes,
    }));
}

/** Processes a capture request once per page load. Returns the titles that were added. */
export async function processCaptureRequest(): Promise<string[]> {
  if (handled || typeof window === "undefined") return [];
  const params = readRequest();
  if (!params) return [];
  handled = true;
  clearRequest();

  const created = await useTaskStore.getState().createTasks(buildTasksFromParams(params));
  return created.map((t) => t.title);
}
