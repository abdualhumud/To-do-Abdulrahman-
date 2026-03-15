import Link from "next/link";
import { CheckCircle, Zap } from "lucide-react";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-base">
      <nav className="fixed top-0 w-full z-50 glass border-b border-base">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
              <CheckCircle className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-lg text-base-fg">TaskFlow</span>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/login" className="btn-secondary text-sm">Sign In</Link>
            <Link href="/register" className="btn-primary text-sm">Get Started Free</Link>
          </div>
        </div>
      </nav>

      <section className="pt-32 pb-20 px-6">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 bg-accent text-accent-fg text-xs font-semibold px-3 py-1.5 rounded-full mb-6">
            <Zap className="w-3.5 h-3.5" />
            Your Personal Productivity Powerhouse
          </div>
          <h1 className="text-5xl md:text-7xl font-black text-base-fg mb-6 leading-tight tracking-tight">
            Get things{" "}
            <span style={{ background: "linear-gradient(135deg, rgb(var(--primary)), rgb(var(--accent-fg)))", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              done.
            </span>
          </h1>
          <p className="text-xl text-secondary-fg max-w-2xl mx-auto mb-10 leading-relaxed">
            TaskFlow is the modern task manager built for high-performers. Manage tasks, track habits, visualize progress, and receive AI-powered daily digest emails.
          </p>
          <div className="flex items-center justify-center gap-4 flex-wrap">
            <Link href="/register" className="btn-primary text-base px-8 py-3.5">Start for Free</Link>
            <Link href="/login" className="btn-secondary text-base px-8 py-3.5">Sign In</Link>
          </div>
        </div>
      </section>

      <section className="py-20 px-6">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl font-bold text-center text-base-fg mb-4">Everything you need to stay productive</h2>
          <p className="text-secondary-fg text-center mb-14 text-lg">Designed for focus. Built for results.</p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              { icon: "✅", bg: "rgb(var(--accent))", title: "Smart Task Management", desc: "Create tasks with priorities, categories, tags, due dates, and subtasks. Drag-and-drop to reorder effortlessly." },
              { icon: "📊", bg: "rgba(34, 197, 94, 0.15)", title: "Progress Analytics", desc: "Visual charts showing productivity trends, completion rates, and category breakdowns over time." },
              { icon: "📧", bg: "rgba(245, 158, 11, 0.15)", title: "Daily Digest Emails", desc: "Get a personalized productivity report every morning with completed tasks, pending items, and your score." },
              { icon: "🔥", bg: "rgba(239, 68, 68, 0.15)", title: "Habit Tracker", desc: "Build powerful daily habits with streak tracking and visual completion indicators." },
              { icon: "⏱️", bg: "rgba(139, 92, 246, 0.15)", title: "Pomodoro Timer", desc: "Stay in flow with an integrated Pomodoro timer linked to your specific tasks." },
              { icon: "🌙", bg: "rgba(99, 102, 241, 0.15)", title: "Dark & Light Mode", desc: "Sleek, eye-friendly interface that adapts to your environment. Your productivity, your way." },
            ].map((f, i) => (
              <div key={i} className="card p-6 hover:shadow-lg transition-shadow duration-200">
                <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-4 text-2xl" style={{ background: f.bg }}>{f.icon}</div>
                <h3 className="font-bold text-base-fg mb-2">{f.title}</h3>
                <p className="text-secondary-fg text-sm leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20 px-6">
        <div className="max-w-3xl mx-auto rounded-2xl p-12 text-center" style={{ background: "linear-gradient(135deg, rgb(var(--primary)), rgb(var(--accent-fg)))" }}>
          <h2 className="text-3xl font-bold text-white mb-4">Ready to transform your productivity?</h2>
          <p className="text-white/80 mb-8">Join thousands of high-performers already using TaskFlow.</p>
          <Link href="/register" className="inline-flex items-center gap-2 bg-white font-bold px-8 py-3.5 rounded-xl hover:opacity-90 transition-opacity" style={{ color: "rgb(var(--primary))" }}>
            Get Started — It&apos;s Free
          </Link>
        </div>
      </section>

      <footer className="border-t border-base py-8 text-center text-secondary-fg text-sm">
        © {new Date().getFullYear()} TaskFlow. Built for productivity.
      </footer>
    </div>
  );
}
