# TaskFlow

A local-first productivity app: tasks, habits, a Pomodoro timer and analytics. It runs entirely in
the browser (no account, no database) and is deployed as a static site to GitHub Pages.

**Live:** https://abdualhumud.github.io/To-do-Abdulrahman-/

## Features

- **Tasks** — priorities, categories, tags, due dates, subtasks, filters, drag-and-drop ordering.
- **Add tasks from anywhere** — Quick add with a live preview, paste a list from Notes/Reminders,
  Apple Shortcuts / Siri / bookmarklet links (`?add=…`), and Telegram. Dates, `#category` and
  `!priority` are understood in English and Arabic. See the in-app **Capture** page.
- **Telegram** — either an always-on server (a free Cloudflare Worker, replies instantly even when
  the app is closed) or browser-only polling with your own bot token.
- **Reminders** — set a time (and repeat: daily, Mon–Fri, Sun–Thu, weekly, monthly) per task, or just write
  “…tomorrow at 5pm”. Delivered in the app, by Telegram, email or phone push (the last three need the bot server).
- **Apple Calendar & Outlook** — add any task as an event (.ics / Outlook link) or subscribe to a live calendar feed.
- **Habits, Pomodoro, analytics**, light/dark theme.
- **Private by design** — data is stored encrypted in your browser; export/import a JSON backup in
  Settings.

## Stack

Next.js 16 (App Router, static export) · React 19 · TypeScript · Tailwind CSS v4 · Zustand · Zod ·
dnd-kit · Recharts. The optional bot server runs on Cloudflare Workers (or Vercel Functions + Upstash Redis).

## Development

```bash
npm ci
npm run dev        # http://localhost:3000/To-do-Abdulrahman-/
npm run lint
npm test           # unit tests: task parser + bot server logic (Node's built-in runner)
npm run build      # static site in out/
npm run test:e2e   # browser suites (needs a build, Playwright + Chromium)
npm run test:worker # Cloudflare Worker on workerd (after `npm ci` in cloudflare/)
```

CI (`.github/workflows/deploy.yml`) runs lint and the unit tests before building and deploying.

## Bot server (optional, recommended)

A free Cloudflare Worker (`cloudflare/`) keeps the bot online, sends reminders every minute and serves the calendar
feed; its data lives in a Durable Object, so no extra database account is needed. Add the repository secrets listed in
`.github/workflows/deploy-worker.yml` and run that workflow — it deploys the Worker, sets its secrets and registers the
Telegram webhook. Then paste the Worker address in **Settings → Telegram**. A Vercel variant of the same server is in
`telegram-bot/`. Design notes are in `CLAUDE.md`.
