"use client";

/**
 * telegram.ts — gets tasks from a private Telegram bot into the app. Two modes:
 *
 * "server"  (recommended) An always-on Vercel server (telegram-bot/) owns the bot: it answers
 *           instantly 24/7 and keeps messages in a small inbox until this app collects them.
 *           The app never sees the bot token.
 * "browser" No server: the browser calls api.telegram.org (getUpdates) with the user's own bot
 *           token (stored encrypted here). Only works while the app is open.
 *
 * In both modes only the chat that completed pairing (/link CODE) is trusted.
 */

import { useSyncExternalStore } from "react";
import { localTelegram, type LocalTelegram } from "@/lib/local-store";
import { useTaskStore } from "@/store/useTaskStore";
import { parseTasksFromText } from "@/lib/task-parser";
import { formatDate } from "@/lib/utils";

const API = "https://api.telegram.org";
const PAIR_TTL_MS = 15 * 60 * 1000;
const TOKEN_RE = /^\d{6,}:[\w-]{20,}$/;
const REQUEST_TIMEOUT_MS = 15_000;

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

/** True once the chat is paired (the server decides in server mode). */
export function isLinked(cfg: LocalTelegram): boolean {
  return cfg.mode === "server" ? cfg.pairCode === null : cfg.chatId !== null;
}

// Form-encoded POST is a "simple" CORS request: no preflight needed.
async function tg<T>(token: string, method: string, params: Record<string, string | number> = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API}/bot${token}/${method}`, {
      method: "POST",
      body: new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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

// ─── Always-on server API ─────────────────────────────────────────────────────

/** "my-bot.vercel.app", "https://my-bot.vercel.app/" or ".../api/setup?key=…" → "https://my-bot.vercel.app" */
export function normalizeServerUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new TelegramError("Enter the address of your bot server, e.g. https://my-bot.vercel.app", "api");
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    throw new TelegramError("That doesn't look like a web address", "api");
  }
  if (url.protocol !== "https:") throw new TelegramError("The bot server address must start with https://", "api");
  return url.origin;
}

interface ServerStatus {
  ok: boolean;
  configured: boolean;
  problem?: string | null;
  bot?: string | null;
  webhookSet?: boolean;
  webhookError?: string | null;
  redis?: boolean;
}

async function server<T>(base: string, path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch {
    throw new TelegramError(`Couldn't reach ${new URL(base).host}. Check the address, and that the server is deployed.`, "network");
  }
  const data = (await res.json().catch(() => null)) as (T & { ok?: boolean; error?: string }) | null;
  if (!data || typeof data !== "object") {
    throw new TelegramError("That address doesn't look like a TaskFlow bot server (no JSON reply).", "api", res.status);
  }
  if (res.status === 401) throw new TelegramError("The server rejected this app's key — press Disconnect and connect again.", "token", 401);
  if (data.ok === false || !res.ok) throw new TelegramError(data.error ?? `Server error ${res.status}`, "api", res.status);
  return data;
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
    mode: "browser",
    token,
    serverUrl: "",
    inboxKey: "",
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

async function startServerPairing(base: string, previousCode?: string | null): Promise<LocalTelegram> {
  const pair = await server<{ code: string; inboxKey: string; bot: string }>(base, "/api/pair", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ previousCode: previousCode ?? undefined }),
  });
  const cfg: LocalTelegram = {
    mode: "server",
    token: "",
    serverUrl: base,
    inboxKey: pair.inboxKey,
    botUsername: pair.bot,
    chatId: null,
    pairCode: pair.code,
    pairExpires: Date.now() + PAIR_TTL_MS,
    offset: 0,
  };
  localTelegram.set(cfg);
  setStatus({ error: null });
  return cfg;
}

export async function connectServer(rawUrl: string): Promise<LocalTelegram> {
  const base = normalizeServerUrl(rawUrl);
  const report = await server<ServerStatus>(base, "/api/status");
  if (!report.configured) {
    throw new TelegramError(`The server is online but not ready: ${report.problem ?? "missing configuration"}.`, "api");
  }
  if (!report.webhookSet) {
    throw new TelegramError(`The server is ready but the bot isn't attached yet. Open ${base}/api/setup?key=YOUR_WEBHOOK_SECRET once, then connect again.`, "api");
  }
  return startServerPairing(base);
}

export async function renewPairCode(): Promise<void> {
  const cfg = localTelegram.get();
  if (!cfg) return;
  if (cfg.mode === "server") {
    await startServerPairing(cfg.serverUrl, cfg.pairCode);
    return;
  }
  localTelegram.set({ ...cfg, chatId: null, pairCode: newPairCode(), pairExpires: Date.now() + PAIR_TTL_MS });
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
  const linkStep = (): DiagStep => ({
    label: "Chat linked",
    ok: isLinked(cfg),
    detail: isLinked(cfg) ? "Yes" : "Not yet — send the /link code to the bot",
  });
  const lastStep = (): DiagStep => ({
    label: "Last check",
    ok: status.error === null,
    detail: status.error ?? (status.lastSync ? new Date(status.lastSync).toLocaleTimeString() : "not yet"),
  });

  if (cfg.mode === "server") {
    try {
      const r = await server<ServerStatus>(cfg.serverUrl, "/api/status");
      steps.push({ label: "Server reachable", ok: true, detail: new URL(cfg.serverUrl).host });
      steps.push({ label: "Server configured", ok: r.configured, detail: r.configured ? "Token, secret and Redis set" : (r.problem ?? "Incomplete") });
      steps.push({ label: "Telegram bot attached", ok: Boolean(r.webhookSet), detail: r.webhookSet ? `@${r.bot}` : `Open ${cfg.serverUrl}/api/setup?key=YOUR_WEBHOOK_SECRET` });
      if (r.webhookError) steps.push({ label: "Telegram delivery", ok: false, detail: r.webhookError });
      steps.push({ label: "Redis inbox", ok: r.redis === true, detail: r.redis === true ? "Working" : "Not responding" });
    } catch (e) {
      steps.push({ label: "Server reachable", ok: false, detail: describe(e) });
      return steps;
    }
    steps.push(linkStep(), lastStep());
    return steps;
  }

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
  steps.push(linkStep(), lastStep());
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

async function runBrowserPoll(initial: LocalTelegram): Promise<PollResult> {
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

// Items already turned into tasks whose acknowledgement may have failed (avoids duplicates).
const collected = new Set<string>();

async function runServerPoll(cfg: LocalTelegram): Promise<PollResult> {
  const auth = { Authorization: `Bearer ${cfg.inboxKey}` };
  let inbox: { linked: boolean; count: number; items: { text: string; at: number }[] };
  try {
    inbox = await server(cfg.serverUrl, "/api/inbox", { headers: auth });
  } catch (e) {
    setStatus({ error: describe(e) });
    return EMPTY;
  }

  const result: PollResult = { added: [], linked: false };
  if (inbox.linked && cfg.pairCode !== null) {
    const latest = localTelegram.get();
    if (latest) localTelegram.set({ ...latest, pairCode: null, pairExpires: null });
    result.linked = true;
  }

  const fresh = inbox.items.filter((item) => !collected.has(`${item.at}|${item.text}`));
  const parsed = fresh.flatMap((item) => parseTasksFromText(item.text));
  if (parsed.length > 0) {
    const created = await useTaskStore.getState().createTasks(
      parsed.map((p) => ({ title: p.title, priority: p.priority, category: p.category, due_date: p.due_date ?? null })),
    );
    result.added.push(...created.map((t) => t.title));
  }
  fresh.forEach((item) => collected.add(`${item.at}|${item.text}`));

  if (inbox.count > 0) {
    // Tasks are saved first; only then is the inbox emptied (at-least-once, no loss).
    const ack = () => server(cfg.serverUrl, "/api/inbox", { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ count: inbox.count }) });
    await ack().catch(() => ack().catch((e) => setStatus({ error: describe(e) })));
  }
  setStatus({ lastSync: Date.now(), error: null });
  return result;
}

async function runPoll(): Promise<PollResult> {
  const cfg = localTelegram.get();
  if (!cfg) return EMPTY;
  return cfg.mode === "server" ? runServerPoll(cfg) : runBrowserPoll(cfg);
}

/** One poll cycle. A Web Lock keeps several open tabs from polling at once. */
export async function pollTelegram(): Promise<PollResult> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (!locks) return runPoll();
  return await locks.request("tf-telegram-poll", { ifAvailable: true }, async (lock) => (lock ? runPoll() : EMPTY));
}
