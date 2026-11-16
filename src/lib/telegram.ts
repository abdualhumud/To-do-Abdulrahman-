"use client";

/**
 * telegram.ts — pulls tasks from a private Telegram bot straight into the app.
 *
 * No server is involved: the browser calls api.telegram.org (getUpdates) with the
 * user's own bot token, which is stored encrypted in this browser only.
 *  - Works while TaskFlow is open; Telegram keeps undelivered messages for 24 hours.
 *  - Only the chat that completed pairing (/link CODE) is trusted — strangers who
 *    find the bot's username are ignored.
 *  - getUpdates and webhooks are mutually exclusive, so connecting removes any webhook.
 */

import { useSyncExternalStore } from "react";
import { localTelegram, type LocalTelegram } from "@/lib/local-store";
import { useTaskStore } from "@/store/useTaskStore";
import { parseTasksFromText } from "@/lib/task-parser";
import { formatDate } from "@/lib/utils";

const API = "https://api.telegram.org";
const PAIR_TTL_MS = 15 * 60 * 1000;

interface TgUser {
  id: number;
  is_bot?: boolean;
}
interface TgMessage {
  message_id: number;
  from?: TgUser;
  chat: { id: number; type: string };
  text?: string;
}
interface TgUpdate {
  update_id: number;
  message?: TgMessage;
}

class TelegramError extends Error {
  constructor(
    message: string,
    readonly code?: number,
  ) {
    super(message);
  }
}

// Form-encoded POST is a "simple" CORS request: no preflight needed.
async function tg<T>(token: string, method: string, params: Record<string, string | number> = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API}/bot${token}/${method}`, {
      method: "POST",
      body: new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])),
    });
  } catch {
    throw new TelegramError("Network error — check your connection");
  }
  const data = (await res.json().catch(() => null)) as { ok: boolean; result: T; description?: string; error_code?: number } | null;
  if (!data?.ok) throw new TelegramError(data?.description ?? `Telegram error ${res.status}`, data?.error_code ?? res.status);
  return data.result;
}

// ─── Status (in-memory) ───────────────────────────────────────────────────────

interface Status {
  lastSync: number | null;
  error: string | null;
}
let status: Status = { lastSync: null, error: null };
const statusListeners = new Set<() => void>();

function setStatus(next: Partial<Status>): void {
  status = { ...status, ...next };
  statusListeners.forEach((cb) => cb());
}

export function useTelegramStatus(): Status {
  return useSyncExternalStore(
    (cb) => {
      statusListeners.add(cb);
      return () => statusListeners.delete(cb);
    },
    () => status,
    () => status,
  );
}

// ─── Connect / pair ───────────────────────────────────────────────────────────

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function newPairCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

export async function connectBot(rawToken: string): Promise<LocalTelegram> {
  const token = rawToken.trim();
  if (!/^\d{6,}:[\w-]{20,}$/.test(token)) {
    throw new TelegramError("That doesn't look like a bot token (expected 123456:ABC…)");
  }
  const me = await tg<{ username?: string }>(token, "getMe");
  await tg<boolean>(token, "deleteWebhook");
  const cfg: LocalTelegram = {
    token,
    botUsername: me.username ?? "",
    chatId: null,
    pairCode: newPairCode(),
    pairExpires: Date.now() + PAIR_TTL_MS,
    offset: 0,
  };
  localTelegram.set(cfg);
  setStatus({ error: null });
  return cfg;
}

export function renewPairCode(): void {
  const cfg = localTelegram.get();
  if (cfg) localTelegram.set({ ...cfg, chatId: null, pairCode: newPairCode(), pairExpires: Date.now() + PAIR_TTL_MS });
}

export function disconnectBot(): void {
  localTelegram.clear();
  setStatus({ lastSync: null, error: null });
}

// ─── Polling ──────────────────────────────────────────────────────────────────

export interface PollResult {
  added: string[];
  linked: boolean;
}
const EMPTY: PollResult = { added: [], linked: false };

function extractLinkCode(text: string): string | null {
  const m = /^\/(?:link|start)(?:@\w+)?\s+(?:link[_-])?([A-Za-z0-9]{6,12})\s*$/.exec(text);
  return m ? m[1].toUpperCase() : null;
}

async function reply(token: string, chatId: number, text: string): Promise<void> {
  try {
    await tg(token, "sendMessage", { chat_id: chatId, text });
  } catch {
    /* best effort */
  }
}

const HELP =
  "TaskFlow bot\n\nSend any message and it becomes a task. One task per line.\n" +
  "Examples:\n• Buy milk tomorrow #personal !high\n• اشتري حليب بكرة\n\n" +
  "Tasks appear in TaskFlow the next time the app is open (within about 30 seconds).";

async function runPoll(): Promise<PollResult> {
  const initial = localTelegram.get();
  if (!initial) return EMPTY;

  let updates: TgUpdate[];
  try {
    updates = await tg<TgUpdate[]>(initial.token, "getUpdates", {
      offset: initial.offset,
      timeout: 0,
      allowed_updates: JSON.stringify(["message"]),
    });
  } catch (e) {
    const err = e as TelegramError;
    if (err.code === 409) {
      await tg(initial.token, "deleteWebhook").catch(() => undefined);
    }
    setStatus({ error: err.code === 401 ? "Bot token was rejected — reconnect the bot" : err.message });
    return EMPTY;
  }

  const result: PollResult = { added: [], linked: false };
  let nextOffset = initial.offset;

  for (const update of updates) {
    nextOffset = Math.max(nextOffset, update.update_id + 1);
    const msg = update.message;
    if (!msg || msg.chat.type !== "private" || !msg.from || msg.from.is_bot) continue;

    const cfg = localTelegram.get();
    if (!cfg) return result; // disconnected while polling
    const text = msg.text?.trim() ?? "";

    const code = extractLinkCode(text);
    if (code && !cfg.chatId && cfg.pairCode === code && cfg.pairExpires && Date.now() < cfg.pairExpires) {
      localTelegram.set({ ...cfg, chatId: msg.chat.id, pairCode: null, pairExpires: null });
      result.linked = true;
      await reply(cfg.token, msg.chat.id, "✅ Linked. Send me anything and it becomes a task in TaskFlow.");
      continue;
    }

    if (cfg.chatId !== msg.chat.id) continue; // not the paired chat → ignore silently

    if (text.startsWith("/")) {
      if (/^\/(start|help)\b/.test(text)) await reply(cfg.token, msg.chat.id, HELP);
      continue;
    }
    if (!text) {
      await reply(cfg.token, msg.chat.id, "Only text messages can become tasks.");
      continue;
    }

    const parsed = parseTasksFromText(text);
    if (parsed.length === 0) continue;
    const created = await useTaskStore.getState().createTasks(
      parsed.map((p) => ({ title: p.title, priority: p.priority, category: p.category, due_date: p.due_date ?? null })),
    );
    result.added.push(...created.map((t) => t.title));
    const lines = created.map((t) => `• ${t.title}${t.due_date ? ` — ${formatDate(t.due_date)}` : ""}`);
    await reply(cfg.token, msg.chat.id, `✅ Added ${created.length} task${created.length === 1 ? "" : "s"}:\n${lines.join("\n")}`);
  }

  const latest = localTelegram.get();
  if (latest && nextOffset !== latest.offset) localTelegram.set({ ...latest, offset: nextOffset });
  setStatus({ lastSync: Date.now(), error: null });
  return result;
}

/** One poll cycle. A Web Lock keeps several open tabs from polling the same bot at once. */
export async function pollTelegram(): Promise<PollResult> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (!locks) return runPoll();
  return await locks.request("tf-telegram-poll", { ifAvailable: true }, async (lock) => (lock ? runPoll() : EMPTY));
}
