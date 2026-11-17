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
const TOKEN_RE = /^\d{6,}:[\w-]{20,}$/;

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

type TelegramErrorKind = "network" | "token" | "conflict" | "rate" | "api";

class TelegramError extends Error {
  constructor(
    message: string,
    readonly kind: TelegramErrorKind,
    readonly code?: number,
  ) {
    super(message);
  }
}

const MSG_NETWORK =
  "Couldn't reach Telegram from this browser. No connection, a VPN, an ad-blocker or a company network can block api.telegram.org.";
const MSG_TOKEN =
  "Telegram doesn't accept this token. Copy it again from @BotFather (/mybots → your bot → API Token) — without < > or spaces.";

function describe(e: unknown): string {
  return e instanceof Error ? e.message : "Unknown error";
}

/** Users paste tokens as "<123:ABC>", "bot123:ABC" or with spaces/newlines — accept all of them. */
export function normalizeToken(raw: string): string {
  return raw.replace(/[\s<>"'“”‘’]/g, "").replace(/^bot/i, "");
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
    throw new TelegramError(MSG_NETWORK, "network");
  }
  const data = (await res.json().catch(() => null)) as {
    ok: boolean;
    result: T;
    description?: string;
    error_code?: number;
  } | null;
  if (data?.ok) return data.result;

  const code = data?.error_code ?? res.status;
  if (code === 401 || code === 404) throw new TelegramError(MSG_TOKEN, "token", code);
  if (code === 409) throw new TelegramError(data?.description ?? "Another consumer is reading this bot", "conflict", code);
  if (code === 429) throw new TelegramError("Telegram asked us to slow down — retrying shortly", "rate", code);
  throw new TelegramError(data?.description ?? `Telegram error ${res.status}`, "api", code);
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
  const token = normalizeToken(rawToken);
  if (!TOKEN_RE.test(token)) {
    throw new TelegramError("That doesn't look like a bot token — it looks like 123456789:AAH… (copy it from @BotFather)", "token");
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

// ─── Diagnostics ──────────────────────────────────────────────────────────────

export interface DiagStep {
  label: string;
  ok: boolean;
  detail: string;
}

/** Step-by-step health check shown in Settings, so a failure names its own cause. */
export async function diagnoseTelegram(): Promise<DiagStep[]> {
  const cfg = localTelegram.get();
  if (!cfg) return [{ label: "Bot connected", ok: false, detail: "Not connected" }];
  const steps: DiagStep[] = [];

  try {
    const me = await tg<{ username?: string }>(cfg.token, "getMe");
    steps.push({ label: "Telegram accepts the token", ok: true, detail: `@${me.username ?? "bot"}` });
  } catch (e) {
    steps.push({ label: "Telegram accepts the token", ok: false, detail: describe(e) });
    return steps;
  }

  try {
    const info = await tg<{ url?: string }>(cfg.token, "getWebhookInfo");
    if (info.url) {
      await tg<boolean>(cfg.token, "deleteWebhook");
      const host = info.url.replace(/^https?:\/\//, "").split("/")[0];
      steps.push({ label: "No webhook blocking polling", ok: true, detail: `Removed a leftover webhook (${host})` });
    } else {
      steps.push({ label: "No webhook blocking polling", ok: true, detail: "Clear" });
    }
  } catch (e) {
    steps.push({ label: "No webhook blocking polling", ok: false, detail: describe(e) });
  }

  steps.push({
    label: "Chat linked",
    ok: cfg.chatId !== null,
    detail: cfg.chatId !== null ? "Yes" : "Not yet — send the /link code to the bot",
  });
  steps.push({
    label: "Last check",
    ok: status.error === null,
    detail: status.error ?? (status.lastSync ? new Date(status.lastSync).toLocaleTimeString() : "not yet"),
  });
  return steps;
}

// ─── Polling ──────────────────────────────────────────────────────────────────

export interface PollResult {
  added: string[];
  linked: boolean;
}
const EMPTY: PollResult = { added: [], linked: false };

/** "/link CODE", "/start link_CODE" (deep link) — and the bare code while pairing. */
function extractLinkCode(text: string, allowBare: boolean): string | null {
  const m = /^\/(?:link|start)(?:@\w+)?\s+(?:link[_-])?([A-Za-z0-9]{6,12})\s*$/.exec(text);
  if (m) return m[1].toUpperCase();
  const bare = allowBare ? /^([A-Za-z0-9]{8})$/.exec(text) : null;
  return bare ? bare[1].toUpperCase() : null;
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

const PAIR_HINT = "To link this chat, send the code shown in TaskFlow → Settings → Telegram, like:\n/link ABCD1234";

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
    if (e instanceof TelegramError && e.kind === "conflict") {
      await tg(initial.token, "deleteWebhook").catch(() => undefined);
    }
    setStatus({ error: describe(e) });
    return EMPTY;
  }

  const result: PollResult = { added: [], linked: false };
  const hinted = new Set<number>();
  let nextOffset = initial.offset;

  for (const update of updates) {
    nextOffset = Math.max(nextOffset, update.update_id + 1);
    const msg = update.message;
    if (!msg || msg.chat.type !== "private" || !msg.from || msg.from.is_bot) continue;

    const cfg = localTelegram.get();
    if (!cfg) return result; // disconnected while polling
    const text = msg.text?.trim() ?? "";
    const pairing = cfg.chatId === null && cfg.pairCode !== null;

    if (pairing) {
      const code = extractLinkCode(text, true);
      if (code && code === cfg.pairCode) {
        if (cfg.pairExpires !== null && Date.now() < cfg.pairExpires) {
          localTelegram.set({ ...cfg, chatId: msg.chat.id, pairCode: null, pairExpires: null });
          result.linked = true;
          await reply(cfg.token, msg.chat.id, "✅ Linked. Send me anything and it becomes a task in TaskFlow.");
        } else {
          await reply(cfg.token, msg.chat.id, "That code expired. Press “New code” in TaskFlow → Settings → Telegram and try again.");
        }
      } else if (!hinted.has(msg.chat.id)) {
        hinted.add(msg.chat.id);
        await reply(cfg.token, msg.chat.id, code ? "That code is not the current one. Copy the latest from TaskFlow → Settings → Telegram." : PAIR_HINT);
      }
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
