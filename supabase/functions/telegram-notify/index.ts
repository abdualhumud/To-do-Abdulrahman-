/**
 * telegram-notify
 *
 * Called by the web app (via supabase.functions.invoke) whenever a task is
 * created or completed on the web.  It looks up the user's linked Telegram
 * chat and sends a short notification message.
 *
 * The request must carry the user's Supabase auth JWT so we know who to
 * notify without trusting client-supplied user IDs.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
// Restrict CORS to the known app origin. Set APP_ORIGIN in Supabase secrets.
// e.g. https://username.github.io
const APP_ORIGIN = Deno.env.get("APP_ORIGIN") ?? "";

const TG_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

async function sendMessage(chatId: number, text: string) {
  await fetch(`${TG_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
  });
}

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  // Only reflect the origin back if it matches our known app origin
  const allowedOrigin = APP_ORIGIN && origin === APP_ORIGIN ? origin : "";
  if (!allowedOrigin) return {};
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    const headers = corsHeaders(req);
    if (!headers["Access-Control-Allow-Origin"]) {
      return new Response("Forbidden", { status: 403 });
    }
    return new Response(null, { headers });
  }

  if (req.method !== "POST") return new Response("OK", { status: 200 });

  // Authenticate the caller with their Supabase JWT
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return new Response("Unauthorized", { status: 401 });

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  // Resolve the user's Telegram chat ID
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("telegram_chat_id")
    .eq("id", user.id)
    .single();

  // If no Telegram linked, silently succeed (no-op)
  if (!profile?.telegram_chat_id) {
    return new Response(JSON.stringify({ sent: false }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const { task, action } = await req.json();
  if (!task) return new Response("Bad request", { status: 400 });

  const PRIORITY_EMOJI: Record<string, string> = {
    low: "🟢",
    medium: "🟡",
    high: "🔴",
    urgent: "🚨",
  };
  const e = PRIORITY_EMOJI[task.priority] ?? "🟡";

  let msg = "";
  if (action === "created") {
    msg = `📱 <b>New task (web):</b>\n${e} ${task.title}`;
    if (task.due_date) msg += `\n📅 Due: ${task.due_date}`;
  } else if (action === "completed") {
    msg = `✅ <b>Completed (web):</b> ${task.title}`;
  }

  if (msg) {
    await sendMessage(profile.telegram_chat_id, msg);
  }

  return new Response(JSON.stringify({ sent: !!msg }), {
    headers: { "Content-Type": "application/json" },
  });
});
