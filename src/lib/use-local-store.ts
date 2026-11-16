"use client";

import { useSyncExternalStore } from "react";
import {
  getStoreVersion,
  localTelegram,
  localUser,
  subscribeStore,
  type LocalTelegram,
  type LocalUser,
} from "@/lib/local-store";

function useVersion(): number {
  return useSyncExternalStore(subscribeStore, getStoreVersion, () => 0);
}

/** `ready` is false on the server and until the store has been decrypted into memory. */
export function useLocalUser(): { ready: boolean; user: LocalUser | null } {
  const version = useVersion();
  const ready = version > 0;
  return { ready, user: ready ? localUser.get() : null };
}

export function useTelegramConfig(): LocalTelegram | null {
  const version = useVersion();
  return version > 0 ? localTelegram.get() : null;
}
