import type { NextConfig } from "next";

// Static export for GitHub Pages. HTTP headers cannot be set on static hosting, so the
// Content-Security-Policy lives in a <meta> tag in src/app/layout.tsx (the single source of truth).
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
};

export default nextConfig;
