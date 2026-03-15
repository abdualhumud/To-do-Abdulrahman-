import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const TG_API = `https://api.telegram.org/bot${BOT_TOKEN}`;
const TG_FILE_API = `https://api.telegram.org/file/bot${BOT_TOKEN}`;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ─── Types ────────────────────────────────────────────────────────────────────

interface TelegramMessage {
  message_id: number;
  chat: { id: number };
  text?: string;
  voice?: { file_id: string; duration: number; mime_type: string };
}

interface ParsedTask {
  title: string;
  category: string;
  priority: string;
  due_date: string | null;
  time_str: string | null;
}

// ─── Telegram API helpers ─────────────────────────────────────────────────────

async function sendMessage(chatId: number, text: string) {
  await fetch(`${TG_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
  });
}

async function getUserByChatId(chatId: number) {
  const { data } = await supabase
    .from("user_profiles")
    .select("id, full_name")
    .eq("telegram_chat_id", chatId)
    .single();
  return data;
}

// ─── Text Parser ──────────────────────────────────────────────────────────────

const VALID_CATEGORIES = [
  "work", "personal", "health", "learning", "finance", "social", "other",
];
const VALID_PRIORITIES = ["low", "medium", "high", "urgent"];

function getDayOfWeekOffset(targetDay: number): number {
  const today = new Date().getDay();
  let offset = targetDay - today;
  if (offset <= 0) offset += 7;
  return offset;
}

function parseTaskText(raw: string): ParsedTask {
  let title = raw;
  let category = "personal";
  let priority = "medium";
  let due_date: string | null = null;
  let time_str: string | null = null;

  // Extract #category  (e.g. #personal, #Work)
  const catMatch = title.match(/#(\w+)/);
  if (catMatch) {
    const cat = catMatch[1].toLowerCase();
    if (VALID_CATEGORIES.includes(cat)) {
      category = cat;
      title = title.replace(catMatch[0], "").trim();
    }
  }

  // Extract !priority  (e.g. !high, !Urgent)
  const priMatch = title.match(/!(\w+)/);
  if (priMatch) {
    const pri = priMatch[1].toLowerCase();
    if (VALID_PRIORITIES.includes(pri)) {
      priority = pri;
      title = title.replace(priMatch[0], "").trim();
    }
  }

  // Extract time  (e.g. "at 5pm", "at 17:30", "at 9:00am")
  const timeMatch = title.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
  if (timeMatch) {
    let hours = parseInt(timeMatch[1]);
    const minutes = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
    const ampm = timeMatch[3]?.toLowerCase();
    if (ampm === "pm" && hours < 12) hours += 12;
    if (ampm === "am" && hours === 12) hours = 0;
    time_str = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
    title = title.replace(timeMatch[0], "").trim();
  }

  // Extract date expressions
  const now = new Date();
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const datePatterns: { regex: RegExp; getDays: (m: RegExpMatchArray) => number }[] = [
    { regex: /\btoday\b/i,            getDays: () => 0 },
    { regex: /\btomorrow\b/i,         getDays: () => 1 },
    { regex: /\bnext week\b/i,        getDays: () => 7 },
    { regex: /\bnext month\b/i,       getDays: () => 30 },
    { regex: /\bin (\d+) days?\b/i,   getDays: (m) => parseInt(m[1]) },
    { regex: /\bmonday\b/i,           getDays: () => getDayOfWeekOffset(1) },
    { regex: /\btuesday\b/i,          getDays: () => getDayOfWeekOffset(2) },
    { regex: /\bwednesday\b/i,        getDays: () => getDayOfWeekOffset(3) },
    { regex: /\bthursday\b/i,         getDays: () => getDayOfWeekOffset(4) },
    { regex: /\bfriday\b/i,           getDays: () => getDayOfWeekOffset(5) },
    { regex: /\bsaturday\b/i,         getDays: () => getDayOfWeekOffset(6) },
    { regex: /\bsunday\b/i,           getDays: () => getDayOfWeekOffset(0) },
  ];

  for (const { regex, getDays } of datePatterns) {
    const match = title.match(regex);
    if (match) {
      const d = new Date(base);
      d.setDate(d.getDate() + getDays(match));
      due_date = d.toISOString().split("T")[0]; // YYYY-MM-DD
      title = title.replace(match[0], "").trim();
      break;
    }
  }

  title = title.replace(/\s{2,}/g, " ").trim();

  return { title, category, priority, due_date, time_str };
}

// ─── Voice Transcription (OpenAI Whisper) ─────────────────────────────────────

async function transcribeVoice(fileId: string): Promise<string | null> {
  // Step 1: Get Telegram file path
  const fileRes = await fetch(`${TG_API}/getFile?file_id=${fileId}`);
  const fileData = await fileRes.json();
  if (!fileData.ok) return null;

  // Step 2: Download the OGG audio
  const fileUrl = `${TG_FILE_API}/${fileData.result.file_path}`;
  const audioRes = await fetch(fileUrl);
  if (!audioRes.ok) return null;
  const audioBuffer = await audioRes.arrayBuffer();

  // Step 3: Send to OpenAI Whisper
  const form = new FormData();
  form.append("file", new Blob([audioBuffer], { type: "audio/ogg" }), "voice.ogg");
  form.append("model", "whisper-1");

  const whisperRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: form,
  });

  if (!whisperRes.ok) return null;
  const { text } = await whisperRes.json();
  return text ?? null;
}

// ─── Command Handlers ─────────────────────────────────────────────────────────

async function handleStart(chatId: number, token?: string) {
  if (!token) {
    await sendMessage(
      chatId,
      "👋 <b>Welcome to TaskFlow Bot!</b>\n\n" +
        "To link your account:\n" +
        "1. Open the TaskFlow web app\n" +
        "2. Go to <b>Settings → Integrations</b>\n" +
        "3. Click <b>Connect Telegram</b>\n" +
        "4. Follow the generated link\n\n" +
        "Once linked you can create tasks by simply sending text or voice messages!",
    );
    return;
  }

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("id, full_name")
    .eq("telegram_link_token", token)
    .single();

  if (!profile) {
    await sendMessage(
      chatId,
      "❌ Invalid or expired link. Please generate a new one from <b>Settings → Integrations</b>.",
    );
    return;
  }

  await supabase
    .from("user_profiles")
    .update({ telegram_chat_id: chatId, telegram_link_token: null })
    .eq("id", profile.id);

  const name = profile.full_name || "there";
  await sendMessage(
    chatId,
    `✅ <b>Account linked, ${name}!</b>\n\n` +
      "<b>What you can do:</b>\n" +
      "📝 Send any <b>text</b> to create a task\n" +
      "🎤 Send a <b>voice note</b> — I'll transcribe & create a task\n" +
      "📋 /tasks — View your pending tasks\n" +
      "✅ /done N — Mark task #N complete\n\n" +
      "<b>Smart text format:</b>\n" +
      "<code>Buy groceries tomorrow at 6pm #personal !high</code>\n\n" +
      "<b>Supported date words:</b> today, tomorrow, next week, monday–sunday, in N days",
  );
}

async function handleListTasks(chatId: number, userId: string) {
  const today = new Date().toISOString().split("T")[0];

  const { data: tasks } = await supabase
    .from("tasks")
    .select("id, title, priority, category, due_date, status")
    .eq("user_id", userId)
    .in("status", ["pending", "in_progress"])
    .or(`due_date.is.null,due_date.lte.${today}`)
    .order("due_date", { ascending: true, nullsFirst: false })
    .limit(10);

  if (!tasks || tasks.length === 0) {
    await sendMessage(chatId, "🎉 No pending tasks — you're all caught up!");
    return;
  }

  const PRIORITY_EMOJI: Record<string, string> = {
    low: "🟢", medium: "🟡", high: "🔴", urgent: "🚨",
  };

  let msg = "📋 <b>Your Pending Tasks:</b>\n\n";
  tasks.forEach((t, i) => {
    const e = PRIORITY_EMOJI[t.priority] ?? "🟡";
    const due = t.due_date ? ` · 📅 ${t.due_date}` : "";
    msg += `${i + 1}. ${e} ${t.title}${due}\n`;
  });
  msg += "\n<i>Use /done N to complete a task</i>";

  await sendMessage(chatId, msg);
}

async function handleDoneTask(chatId: number, userId: string, taskIndex: number) {
  const today = new Date().toISOString().split("T")[0];

  const { data: tasks } = await supabase
    .from("tasks")
    .select("id, title")
    .eq("user_id", userId)
    .in("status", ["pending", "in_progress"])
    .or(`due_date.is.null,due_date.lte.${today}`)
    .order("due_date", { ascending: true, nullsFirst: false })
    .limit(10);

  if (!tasks || taskIndex < 0 || taskIndex >= tasks.length) {
    await sendMessage(chatId, "❌ Invalid number. Use /tasks to see the list.");
    return;
  }

  const task = tasks[taskIndex];
  await supabase
    .from("tasks")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("id", task.id);

  await sendMessage(chatId, `✅ <b>Done:</b> ${task.title} 🎉`);
}

async function handleTextTask(chatId: number, userId: string, text: string) {
  const parsed = parseTaskText(text);

  if (!parsed.title) {
    await sendMessage(chatId, "❌ Couldn't parse a task title. Please try again.");
    return;
  }

  const { data: task, error } = await supabase
    .from("tasks")
    .insert({
      user_id: userId,
      title: parsed.title,
      category: parsed.category,
      priority: parsed.priority,
      due_date: parsed.due_date,
      status: "pending",
      source: "telegram",
    })
    .select()
    .single();

  if (error || !task) {
    await sendMessage(chatId, "❌ Failed to save task. Please try again.");
    return;
  }

  const PRIORITY_EMOJI: Record<string, string> = {
    low: "🟢", medium: "🟡", high: "🔴", urgent: "🚨",
  };
  const e = PRIORITY_EMOJI[parsed.priority] ?? "🟡";

  let confirm = `✅ <b>Task added!</b>\n\n📝 <b>${parsed.title}</b>\n${e} ${parsed.priority} · 📁 ${parsed.category}`;
  if (parsed.due_date) {
    confirm += `\n📅 ${parsed.due_date}${parsed.time_str ? " at " + parsed.time_str : ""}`;
  }

  await sendMessage(chatId, confirm);
}

async function handleVoiceMessage(
  chatId: number,
  userId: string,
  voice: { file_id: string },
) {
  await sendMessage(chatId, "🎤 Transcribing your voice message...");

  const transcription = await transcribeVoice(voice.file_id);

  if (!transcription) {
    await sendMessage(
      chatId,
      "❌ Couldn't transcribe the audio. Please send text instead.",
    );
    return;
  }

  await sendMessage(
    chatId,
    `🔤 <b>Heard:</b> <i>"${transcription}"</i>\n\nCreating task...`,
  );
  await handleTextTask(chatId, userId, transcription);
}

// ─── Message Router ───────────────────────────────────────────────────────────

async function handleMessage(message: TelegramMessage) {
  const chatId = message.chat.id;

  // /start is the only command allowed without a linked account
  if (message.text?.startsWith("/start")) {
    const token = message.text.split(" ")[1];
    await handleStart(chatId, token);
    return;
  }

  const user = await getUserByChatId(chatId);
  if (!user) {
    await sendMessage(
      chatId,
      "⚠️ <b>Account not linked.</b>\n\n" +
        "Go to <b>Settings → Integrations</b> in the TaskFlow web app to connect Telegram.",
    );
    return;
  }

  if (message.text === "/tasks") {
    await handleListTasks(chatId, user.id);
    return;
  }

  if (message.text?.startsWith("/done ")) {
    const n = parseInt(message.text.split(" ")[1]);
    if (!isNaN(n)) {
      await handleDoneTask(chatId, user.id, n - 1);
    } else {
      await sendMessage(chatId, "❌ Usage: /done 1  (use the number from /tasks)");
    }
    return;
  }

  if (message.voice) {
    await handleVoiceMessage(chatId, user.id, message.voice);
    return;
  }

  if (message.text && !message.text.startsWith("/")) {
    await handleTextTask(chatId, user.id, message.text);
    return;
  }

  await sendMessage(
    chatId,
    "❓ <b>Available commands:</b>\n📋 /tasks · ✅ /done N\n\nOr just send a <b>text</b> or <b>voice message</b> to create a task!",
  );
}

// ─── Entry Point ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("TaskFlow Telegram Bot ✓", { status: 200 });
  }

  try {
    const update = await req.json();
    if (update.message) {
      await handleMessage(update.message);
    }
  } catch (err) {
    console.error("Webhook error:", err);
  }

  return new Response("OK", { status: 200 });
});
