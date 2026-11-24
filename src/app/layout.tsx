import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { Toaster } from "react-hot-toast";
import { buildCsp } from "@/lib/csp";

// iPhone: draw under the notch/home bar (safe-area insets are applied in CSS), keep pinch-zoom for accessibility.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8fafc" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a14" },
  ],
};

export const metadata: Metadata = {
  manifest: "/To-do-Abdulrahman-/manifest.webmanifest",
  appleWebApp: { capable: true, title: "TaskFlow", statusBarStyle: "default" },
  icons: { icon: "/To-do-Abdulrahman-/icon-192.png", apple: "/To-do-Abdulrahman-/apple-touch-icon.png" },
  formatDetection: { telephone: false },
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
        {/* Apply the saved language (lang + RTL) before first paint so there is no flash. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var l=localStorage.getItem("tf_lang");if(!l)l=/^ar\\b/i.test(navigator.language)?"ar":"en";var d=document.documentElement;d.lang=l;d.dir=l==="ar"?"rtl":"ltr"}catch(e){}`,
          }}
        />
      </head>
      <body>
        <ThemeProvider>
          {children}
          <Toaster
            position="top-center"
            containerStyle={{ top: "calc(env(safe-area-inset-top) + 0.5rem)" }}
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
