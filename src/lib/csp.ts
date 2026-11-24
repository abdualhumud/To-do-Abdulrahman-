/**
 * Content-Security-Policy for the static site (injected as a <meta> in layout.tsx).
 * `connect-src` allows the bot servers: *.workers.dev and *.vercel.app by default, plus any extra
 * HTTPS origins listed in the NEXT_PUBLIC_BOT_ORIGINS build variable (space separated), e.g. a custom
 * domain "https://bot.example.com". Entries are validated so a typo can't inject other directives.
 */

const ORIGIN = /^https:\/\/(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(:\d{1,5})?$/i;

export function extraBotOrigins(raw: string | undefined): string[] {
  return (raw ?? "").split(/\s+/).filter((o) => ORIGIN.test(o));
}

export function buildCsp(extraOrigins: string = ""): string {
  const connect = ["'self'", "https://api.telegram.org", "https://*.workers.dev", "https://*.vercel.app", ...extraBotOrigins(extraOrigins)];
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https://avatars.githubusercontent.com https://lh3.googleusercontent.com",
    "font-src 'self'",
    `connect-src ${[...new Set(connect)].join(" ")}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "upgrade-insecure-requests",
  ].join("; ");
}
