import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { Toaster } from "react-hot-toast";
import { buildCsp } from "@/lib/csp";

export const metadata: Metadata = {
  title: "TaskFlow — Personal Productivity System",
  description: "A local-first task manager with habits, a Pomodoro timer and analytics. Add tasks from Apple Shortcuts, Notes or Telegram.",
};

// CSP meta tag — effective on GitHub Pages (static hosting) where HTTP headers can't be set.
// Single source of truth: next.config.ts cannot send headers with `output: "export"`.
const CSP_META = buildCsp(process.env.NEXT_PUBLIC_BOT_ORIGINS);

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Security: Content-Security-Policy — prevents XSS and data exfiltration */}
        <meta httpEquiv="Content-Security-Policy" content={CSP_META} />
        <meta name="referrer" content="strict-origin-when-cross-origin" />
      </head>
      <body>
        <ThemeProvider>
          {children}
          <Toaster
            position="top-right"
            toastOptions={{
              style: {
                background: "rgb(var(--card))",
                color: "rgb(var(--fg))",
                border: "1px solid rgb(var(--border))",
                borderRadius: "0.75rem",
                fontSize: "0.875rem",
              },
              success: { iconTheme: { primary: "#22c55e", secondary: "#fff" } },
              error: { iconTheme: { primary: "#ef4444", secondary: "#fff" } },
            }}
          />
        </ThemeProvider>
      </body>
    </html>
  );
}
