import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { Toaster } from "react-hot-toast";

export const metadata: Metadata = {
  title: "TaskFlow — Personal Productivity System",
  description: "A powerful, modern personal task management system with analytics, habits, and daily reports.",
};

// CSP meta tag — effective on GitHub Pages (static hosting) where HTTP headers can't be set.
// The same policy is also set via next.config.ts headers() for non-static deployments.
const CSP_META = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://avatars.githubusercontent.com https://lh3.googleusercontent.com",
  "font-src 'self'",
  "connect-src 'self' https://*.supabase.co https://api.telegram.org",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "upgrade-insecure-requests",
].join("; ");

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Security: Content-Security-Policy — prevents XSS and data exfiltration */}
        <meta httpEquiv="Content-Security-Policy" content={CSP_META} />
        <meta httpEquiv="X-Content-Type-Options" content="nosniff" />
        <meta httpEquiv="Referrer-Policy" content="strict-origin-when-cross-origin" />
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
