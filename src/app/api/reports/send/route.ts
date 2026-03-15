import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { Resend } from "resend";
import { format } from "date-fns";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Fetch user profile
    const { data: profile } = await supabase
      .from("user_profiles")
      .select("*")
      .eq("id", user.id)
      .single();

    // Fetch tasks
    const { data: tasks } = await supabase
      .from("tasks")
      .select("*")
      .eq("user_id", user.id);

    if (!tasks) return NextResponse.json({ error: "No tasks found" }, { status: 400 });

    const today = new Date();
    const todayStr = format(today, "yyyy-MM-dd");
    const tomorrowStr = format(new Date(today.getTime() + 86400000), "yyyy-MM-dd");

    const completedToday = tasks.filter(
      (t) => t.status === "completed" && t.completed_at?.startsWith(todayStr)
    );
    const pendingTomorrow = tasks.filter(
      (t) => t.status !== "completed" && t.due_date === tomorrowStr
    );
    const overdueTasks = tasks.filter(
      (t) => t.status !== "completed" && t.due_date && t.due_date < todayStr
    );
    const totalPending = tasks.filter((t) => t.status === "pending" || t.status === "in_progress");
    const productivityScore = tasks.length > 0
      ? Math.round((tasks.filter((t) => t.status === "completed").length / tasks.length) * 100)
      : 0;

    const displayName = profile?.full_name || user.email?.split("@")[0] || "there";

    const html = generateReportHTML({
      displayName,
      completedToday,
      pendingTomorrow,
      overdueTasks,
      totalPending,
      productivityScore,
      date: format(today, "EEEE, MMMM d, yyyy"),
    });

    const { error: emailError } = await resend.emails.send({
      from: "TaskFlow <reports@taskflow.app>",
      to: user.email!,
      subject: `📊 Your Daily Productivity Digest — ${format(today, "MMM d")}`,
      html,
    });

    if (emailError) {
      console.error("Email send error:", emailError);
      return NextResponse.json({ error: "Failed to send email" }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Report error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

interface ReportData {
  displayName: string;
  completedToday: { title: string; priority: string; category: string }[];
  pendingTomorrow: { title: string; priority: string; category: string }[];
  overdueTasks: { title: string; due_date: string }[];
  totalPending: { title: string }[];
  productivityScore: number;
  date: string;
}

function generateReportHTML(data: ReportData): string {
  const scoreColor = data.productivityScore >= 80 ? "#22c55e" : data.productivityScore >= 50 ? "#f59e0b" : "#ef4444";
  const scoreEmoji = data.productivityScore >= 80 ? "🌟" : data.productivityScore >= 50 ? "💪" : "🎯";

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Daily Productivity Digest</title>
</head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8fafc;color:#0f172a;">
  <div style="max-width:600px;margin:0 auto;padding:40px 20px;">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,#6366f1,#4338ca);border-radius:16px;padding:32px;text-align:center;margin-bottom:24px;">
      <div style="font-size:40px;margin-bottom:8px;">✅</div>
      <h1 style="color:white;margin:0 0 4px;font-size:24px;font-weight:800;">TaskFlow</h1>
      <p style="color:rgba(255,255,255,0.8);margin:0;font-size:14px;">Daily Productivity Digest</p>
      <p style="color:rgba(255,255,255,0.6);margin:8px 0 0;font-size:13px;">${data.date}</p>
    </div>

    <!-- Greeting -->
    <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:24px;margin-bottom:16px;">
      <h2 style="margin:0 0 8px;font-size:20px;">Hey ${data.displayName}! 👋</h2>
      <p style="margin:0;color:#64748b;font-size:14px;line-height:1.6;">
        Here's your daily summary. Keep up the momentum — every completed task brings you closer to your goals!
      </p>
    </div>

    <!-- Score Card -->
    <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:24px;margin-bottom:16px;text-align:center;">
      <p style="margin:0 0 4px;color:#64748b;font-size:13px;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">PRODUCTIVITY SCORE</p>
      <div style="font-size:56px;font-weight:900;color:${scoreColor};margin:8px 0;">${data.productivityScore}%</div>
      <p style="margin:0;font-size:18px;">${scoreEmoji} ${getScoreMessage(data.productivityScore)}</p>
    </div>

    <!-- Stats Row -->
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:16px;">
      ${[
        { label: "Completed Today", value: data.completedToday.length, color: "#22c55e", bg: "#f0fdf4" },
        { label: "Due Tomorrow", value: data.pendingTomorrow.length, color: "#6366f1", bg: "#eef2ff" },
        { label: "Overdue", value: data.overdueTasks.length, color: "#ef4444", bg: "#fef2f2" },
      ].map(s => `
        <div style="background:${s.bg};border:1px solid ${s.color}22;border-radius:12px;padding:16px;text-align:center;">
          <div style="font-size:28px;font-weight:800;color:${s.color};">${s.value}</div>
          <div style="font-size:11px;color:#64748b;margin-top:4px;font-weight:500;">${s.label}</div>
        </div>
      `).join("")}
    </div>

    ${data.completedToday.length > 0 ? `
    <!-- Completed Today -->
    <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:24px;margin-bottom:16px;">
      <h3 style="margin:0 0 16px;font-size:16px;display:flex;align-items:center;gap:8px;">
        ✅ Completed Today <span style="background:#dcfce7;color:#16a34a;font-size:12px;padding:2px 8px;border-radius:20px;">${data.completedToday.length}</span>
      </h3>
      ${data.completedToday.map(t => `
        <div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid #f1f5f9;">
          <span style="color:#22c55e;font-size:16px;">✓</span>
          <div>
            <div style="font-size:14px;font-weight:500;color:#0f172a;">${t.title}</div>
            <div style="font-size:12px;color:#94a3b8;margin-top:2px;text-transform:capitalize;">${t.category} · ${t.priority}</div>
          </div>
        </div>
      `).join("")}
    </div>
    ` : ""}

    ${data.pendingTomorrow.length > 0 ? `
    <!-- Due Tomorrow -->
    <div style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:24px;margin-bottom:16px;">
      <h3 style="margin:0 0 16px;font-size:16px;">📅 Due Tomorrow</h3>
      ${data.pendingTomorrow.map(t => `
        <div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid #f1f5f9;">
          <span style="color:#6366f1;font-size:16px;">○</span>
          <div>
            <div style="font-size:14px;font-weight:500;">${t.title}</div>
            <div style="font-size:12px;color:#94a3b8;margin-top:2px;text-transform:capitalize;">${t.category} · ${t.priority} priority</div>
          </div>
        </div>
      `).join("")}
    </div>
    ` : ""}

    ${data.overdueTasks.length > 0 ? `
    <!-- Overdue -->
    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:24px;margin-bottom:16px;">
      <h3 style="margin:0 0 16px;font-size:16px;color:#dc2626;">⚠️ Overdue Tasks</h3>
      ${data.overdueTasks.map(t => `
        <div style="display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid #fecaca;">
          <span style="color:#ef4444;">!</span>
          <div>
            <div style="font-size:14px;font-weight:500;color:#991b1b;">${t.title}</div>
            <div style="font-size:12px;color:#ef4444;margin-top:2px;">Due ${t.due_date}</div>
          </div>
        </div>
      `).join("")}
    </div>
    ` : ""}

    <!-- CTA -->
    <div style="text-align:center;margin-top:24px;">
      <a href="${process.env.NEXT_PUBLIC_APP_URL}/dashboard" style="display:inline-block;background:linear-gradient(135deg,#6366f1,#4338ca);color:white;padding:14px 32px;border-radius:12px;text-decoration:none;font-weight:700;font-size:15px;">
        Open TaskFlow Dashboard →
      </a>
    </div>

    <!-- Footer -->
    <p style="text-align:center;color:#94a3b8;font-size:12px;margin-top:32px;line-height:1.6;">
      This email was sent by TaskFlow · <a href="${process.env.NEXT_PUBLIC_APP_URL}/settings" style="color:#6366f1;">Manage email preferences</a>
    </p>
  </div>
</body>
</html>
  `.trim();
}

function getScoreMessage(score: number): string {
  if (score >= 90) return "Outstanding performance!";
  if (score >= 75) return "Great job today!";
  if (score >= 50) return "Good progress, keep it up!";
  if (score >= 25) return "You're making moves!";
  return "Every step forward counts!";
}
