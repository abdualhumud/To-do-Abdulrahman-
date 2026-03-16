import type { NextConfig } from "next";

// Content Security Policy for the static export.
// Note: GitHub Pages only serves static files, so HTTP headers set here only
// apply when using `next start`. For GitHub Pages, we add a <meta> CSP tag in layout.tsx.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'", // 'unsafe-inline' required by Next.js static export
  "style-src 'self' 'unsafe-inline'", // required by Tailwind CSS
  "img-src 'self' data: https://avatars.githubusercontent.com https://lh3.googleusercontent.com",
  "font-src 'self'",
  "connect-src 'self' https://*.supabase.co https://api.telegram.org",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: CSP },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  output: "export",
  basePath: "/To-do-Abdulrahman-",
  trailingSlash: true,
  images: {
    unoptimized: true,
    // Restrict to known trusted image domains only (no wildcard)
    remotePatterns: [
      { protocol: "https", hostname: "avatars.githubusercontent.com" },
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
    ],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
