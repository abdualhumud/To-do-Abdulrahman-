"use client";

import { useSyncExternalStore } from "react";
import {
  DEFAULT_PREFS,
  getStoreVersion,
  isHydrated,
  localPrefs,
  localSync,
  localTelegram,
  localUser,
  subscribeStore,
  type LocalPrefs,
  type LocalSync,
  type LocalTelegram,
  type LocalUser,
} from "@/lib/local-store";

function useVersion(): number {
  return useSyncExternalStore(subscribeStore, getStoreVersion, () => 0);
}

/** `ready` is false on the server and until the store has been decrypted into memory. */
export function useLocalUser(): { ready: boolean; user: LocalUser | null } {
  const version = useVersion();
  const ready = version > 0 && isHydrated();
  return { ready, user: ready ? localUser.get() : null };
}

export function useTelegramConfig(): LocalTelegram | null {
  const version = useVersion();
  return version > 0 ? localTelegram.get() : null;
}

export function usePrefs(): LocalPrefs {
  const version = useVersion();
  return version > 0 ? localPrefs.get() : DEFAULT_PREFS;
}

export function useLocalSync(): LocalSync | null {
  const version = useVersion();
  return version > 0 ? localSync.get() : null;
}
