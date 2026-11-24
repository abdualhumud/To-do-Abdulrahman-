"use client";

/** Observable status of multi-device sync. Kept free of imports so any module can read it. */

import { useSyncExternalStore } from "react";

export interface SyncStatus {
  /** A round is running. */
  syncing: boolean;
  lastSync: number | null;
  error: string | null;
  /** Last round finished and nothing local was waiting to be pushed. */
  current: boolean;
}

let status: SyncStatus = { syncing: false, lastSync: null, error: null, current: false };
const listeners = new Set<() => void>();

export const getSyncStatus = (): SyncStatus => status;

export function setSyncStatus(next: Partial<SyncStatus>): void {
  status = { ...status, ...next };
  listeners.forEach((cb) => cb());
}

export function subscribeSyncStatus(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(subscribeSyncStatus, getSyncStatus, getSyncStatus);
}
