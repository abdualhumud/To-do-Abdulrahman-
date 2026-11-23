# TaskFlow

A local-first productivity app: tasks, habits, a Pomodoro timer and analytics. It runs entirely in
the browser (no account, no database) and is deployed as a static site to GitHub Pages.

**Live:** https://abdualhumud.github.io/To-do-Abdulrahman-/

## Features

- **Tasks** — priorities, categories, tags, due dates, subtasks, filters, drag-and-drop ordering.
- **Add tasks from anywhere** — Quick add with a live preview, paste a list from Notes/Reminders,
  Apple Shortcuts / Siri / bookmarklet links (`?add=…`), and Telegram. Dates, `#category` and
  `!priority` are understood in English and Arabic. See the in-app **Capture** page.
- **Telegram** — either an always-on server (`telegram-bot/` on Vercel, replies instantly even when
  the app is closed) or browser-only polling with your own bot token.
- **Habits, Pomodoro, analytics**, light/dark theme.
- **Private by design** — data is stored encrypted in your browser; export/import a JSON backup in
  Settings.

## Stack

Next.js 16 (App Router, static export) · React 19 · TypeScript · Tailwind CSS v4 · Zustand · Zod ·
dnd-kit · Recharts. The optional bot server uses Vercel Functions + Upstash Redis.

## Development

```bash
npm ci
npm run dev        # http://localhost:3000/To-do-Abdulrahman-/
npm run lint
npm test           # unit tests: task parser + bot server logic (Node's built-in runner)
npm run build      # static site in out/
npm run test:e2e   # browser suites (needs a build, Playwright + Chromium)
```

CI (`.github/workflows/deploy.yml`) runs lint and the unit tests before building and deploying.

## Telegram server (optional)

Deploy the `telegram-bot/` folder as its own Vercel project (Root Directory `telegram-bot`), set
`TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET`, connect Upstash Redis, open
`/api/setup?key=<secret>` once, then paste the project address in **Settings → Telegram**.
Details and design notes are in `CLAUDE.md`.
