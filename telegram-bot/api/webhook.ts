/**
 * TaskFlow Telegram Bot — Standalone Webhook
 *
 * Deploy this to Vercel (or any serverless platform).
 * Required environment variables:
 *   TELEGRAM_BOT_TOKEN       — from @BotFather
 *   TELEGRAM_WEBHOOK_SECRET  — any random string you choose (set when calling setWebhook)
 *
 * Storage: Upstash Redis (free tier).  Set these env vars too:
 *   UPSTASH_REDIS_REST_URL
 *   UPSTASH_REDIS_REST_TOKEN
 *
 * Or run without Redis — tasks survive only while the serverless instance is warm.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";

// ─── Config ────────────────────────────────────────────────────────────────────

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET ?? "";
const TG = `https://api.telegram.org/bot${BOT_TOKEN}`;

// Optional Upstash Redis — gracefully degrades to in-process Map when absent
const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL ?? "";
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN ?? "";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface Task {
  id: number;
  title: string;
  priority: string;
  category: string;
  due: string | null;
  done: boolean;
  createdAt: string;
}

interface TgMessage {
  message_id: number;
  chat: { id: number };
  text?: string;
}

// ─── Simple KV (Upstash Redis or in-process fallback) ─────────────────────────

const _mem = new Map<string, Task[]>();

async function loadTasks(chatId: number): Promise<Task[]> {
  const key = `tasks:${chatId}`;
  if (REDIS_URL && REDIS_TOKEN) {
    try {
      const res = await fetch(`${REDIS_URL}/get/${key}`, {
        headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
      });
      const json = await res.json();
      return json.result ? JSON.parse(json.result) : [];
    } catch {
      return _mem.get(key) ?? [];
    }
  }
  return _mem.get(key) ?? [];
}

async function saveTasks(chatId: number, tasks: Task[]): Promise<void> {
  const key = `tasks:${chatId}`;
  _mem.set(key, tasks);
  if (REDIS_URL && REDIS_TOKEN) {
    try {
      await fetch(`${REDIS_URL}/set/${key}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${REDIS_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ value: JSON.stringify(tasks) }),
      });
    } catch {
      // silently ignore — data lives in _mem for this instance lifetime
    }
  }
}

// ─── Task Text Parser ──────────────────────────────────────────────────────────

const VALID_CATEGORIES = ["work", "personal", "health", "learning", "finance", "social", "other"];
const VALID_PRIORITIES = ["low", "medium", "high", "urgent"];

function getDayOffset(targetDay: number): number {
  const today = new Date().getDay();
  let offset = targetDay - today;
  if (offset <= 0) offset += 7;
  return offset;
}

function parseTask(raw: string): Omit<Task, "id" | "done" | "createdAt"> {
  let title = raw;
  let category = "personal";
  let priority = "medium";
  let due: string | null = null;

  const catMatch = title.match(/#(\w+)/);
  if (catMatch && VALID_CATEGORIES.includes(catMatch[1].toLowerCase())) {
    category = catMatch[1].toLowerCase();
    title = title.replace(catMatch[0], "").trim();
  }

  const priMatch = title.match(/!(\w+)/);
  if (priMatch && VALID_PRIORITIES.includes(priMatch[1].toLowerCase())) {
    priority = priMatch[1].toLowerCase();
    title = title.replace(priMatch[0], "").trim();
  }

  const base = new Date();
  base.setHours(0, 0, 0, 0);

  const dateMap: { regex: RegExp; days: () => number }[] = [
    { regex: /\btoday\b/i, days: () => 0 },
    { regex: /\btomorrow\b/i, days: () => 1 },
    { regex: /\bnext week\b/i, days: () => 7 },
    { regex: /\bin (\d+) days?\b/i, days: () => parseInt(title.match(/in (\d+) days?/i)![1]) },
    { regex: /\bmonday\b/i, days: () => getDayOffset(1) },
    { regex: /\btuesday\b/i, days: () => getDayOffset(2) },
    { regex: /\bwednesday\b/i, days: () => getDayOffset(3) },
    { regex: /\bthursday\b/i, days: () => getDayOffset(4) },
    { regex: /\bfriday\b/i, days: () => getDayOffset(5) },
    { regex: /\bsaturday\b/i, days: () => getDayOffset(6) },
    { regex: /\bsunday\b/i, days: () => getDayOffset(0) },
  ];

  for (const { regex, days } of dateMap) {
    const m = title.match(regex);
    if (m) {
      const d = new Date(base);
      d.setDate(d.getDate() + days());
      due = d.toISOString().split("T")[0];
      title = title.replace(m[0], "").trim();
      break;
    }
  }

  title = title.replace(/\s{2,}/g, " ").trim();
  return { title, priority, category, due };
}

// ─── Telegram Helpers ──────────────────────────────────────────────────────────

async function tgPost(method: string, body: object) {
  return fetch(`${TG}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function reply(chatId: number, text: string) {
  await tgPost("sendMessage", { chat_id: chatId, text, parse_mode: "HTML" });
}

// ─── Command Handlers ──────────────────────────────────────────────────────────

const EMOJI: Record<string, string> = { low: "🟢", medium: "🟡", high: "🔴", urgent: "🚨" };

async function handleStart(chatId: number) {
  await reply(
    chatId,
    "👋 <b>Welcome to TaskFlow Bot!</b>\n\n" +
      "Add tasks by just sending a message.\n\n" +
      "<b>Smart format:</b>\n" +
      "<code>Buy groceries tomorrow #personal !high</code>\n\n" +
      "<b>Commands:</b>\n" +
      "📋 /tasks — list pending tasks\n" +
      "✅ /done 1 — mark task #1 complete\n" +
      "🗑 /clear — remove all completed tasks",
  );
}

async function handleListTasks(chatId: number) {
  const tasks = (await loadTasks(chatId)).filter((t) => !t.done);
  if (tasks.length === 0) {
    await reply(chatId, "🎉 No pending tasks — you're all caught up!");
    return;
  }
  let msg = "📋 <b>Your Pending Tasks:</b>\n\n";
  tasks.forEach((t, i) => {
    const e = EMOJI[t.priority] ?? "🟡";
    const due = t.due ? ` · 📅 ${t.due}` : "";
    msg += `${i + 1}. ${e} ${t.title}${due}\n`;
  });
  msg += "\n<i>Use /done N to complete a task</i>";
  await reply(chatId, msg);
}

async function handleDone(chatId: number, n: number) {
  const allTasks = await loadTasks(chatId);
  const pending = allTasks.filter((t) => !t.done);
  const idx = n - 1;
  if (idx < 0 || idx >= pending.length) {
    await reply(chatId, "❌ Invalid number. Use /tasks to see the list.");
    return;
  }
  const target = pending[idx];
  const updated = allTasks.map((t) => (t.id === target.id ? { ...t, done: true } : t));
  await saveTasks(chatId, updated);
  await reply(chatId, `✅ <b>Done:</b> ${target.title} 🎉`);
}

async function handleClear(chatId: number) {
  const tasks = (await loadTasks(chatId)).filter((t) => !t.done);
  await saveTasks(chatId, tasks);
  await reply(chatId, "🗑 Completed tasks cleared.");
}

async function handleTextTask(chatId: number, text: string) {
  const parsed = parseTask(text);
  if (!parsed.title) {
    await reply(chatId, "❌ Couldn't parse a task title. Please try again.");
    return;
  }
  const tasks = await loadTasks(chatId);
  const task: Task = {
    id: Date.now(),
    ...parsed,
    done: false,
    createdAt: new Date().toISOString(),
  };
  await saveTasks(chatId, [...tasks, task]);

  const e = EMOJI[task.priority] ?? "🟡";
  let confirm = `✅ <b>Task added!</b>\n\n📝 <b>${task.title}</b>\n${e} ${task.priority} · 📁 ${task.category}`;
  if (task.due) confirm += `\n📅 Due: ${task.due}`;
  await reply(chatId, confirm);
}

// ─── Message Router ─────────────────────────────────────────────────────────────

async function handleMessage(msg: TgMessage) {
  const chatId = msg.chat.id;
  const text = msg.text ?? "";

  if (text === "/start" || text.startsWith("/start ")) return handleStart(chatId);
  if (text === "/tasks") return handleListTasks(chatId);
  if (text === "/clear") return handleClear(chatId);

  const doneMatch = text.match(/^\/done\s+(\d+)$/);
  if (doneMatch) return handleDone(chatId, parseInt(doneMatch[1]));

  if (text && !text.startsWith("/")) return handleTextTask(chatId, text);

  await reply(
    chatId,
    "❓ <b>Commands:</b>\n📋 /tasks · ✅ /done N · 🗑 /clear\n\nOr send text to create a task!",
  );
}

// ─── Webhook Entry Point ────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(200).send("TaskFlow Telegram Bot ✓");
  }

  // Verify the secret token Telegram sends in the header
  if (WEBHOOK_SECRET) {
    const token = req.headers["x-telegram-bot-api-secret-token"];
    if (token !== WEBHOOK_SECRET) {
      return res.status(401).send("Unauthorized");
    }
  }

  try {
    const update = req.body;
    if (update?.message) {
      await handleMessage(update.message as TgMessage);
    }
  } catch (err) {
    console.error("Webhook error:", err);
  }

  return res.status(200).send("OK");
}
