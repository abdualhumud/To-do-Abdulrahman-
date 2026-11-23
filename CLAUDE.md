# TaskFlow — CLAUDE.md

Project knowledge base for AI-assisted development: decisions, pitfalls and verified fixes.

Live: `https://abdualhumud.github.io/To-do-Abdulrahman-/` · Branch: `claude/build-todo-app-BLpsC`

---

## What this is

A local-first productivity app (tasks, habits, Pomodoro, analytics) built with Next.js 16
(`output: "export"`) and deployed as a static site to GitHub Pages. There is **no backend**:
all data lives in the browser. (Supabase code/deps and 16 unused UI deps were removed — don't re-add them.)

```ts
// next.config.ts — required for GitHub Pages
output: "export",
basePath: "/To-do-Abdulrahman-",   // must match the repo name
trailingSlash: true,
images: { unoptimized: true },
```

Commands: `npm ci` · `npm run lint` · `npm test` (unit) · `node_modules/.bin/next build` (output in `out/`) ·
`npm run test:e2e` (browser suites). CI runs lint + unit tests before build/deploy. `npm audit` is at 0 — keep
`next` on a patched release (it was pinned to an old exact version that carried a critical advisory).

---

## Data layer — `src/lib/local-store.ts` (read this before touching storage)

### How it works
1. `hydrateLocalStore()` runs once at module load: opens the encryption key, decrypts every
   key from localStorage **into an in-memory cache**, then bumps a version counter.
2. After hydration every read is synchronous (`localTasks.get()`), every write is
   write-through (cache first, then a serialized async encrypt+`setItem` chain that always
   persists the *latest* value).
3. UI gates on readiness: `useLocalUser()` (`src/lib/use-local-store.ts`) returns
   `{ready:false}` until hydration finishes — the dashboard layout shows a spinner, never
   redirects to /login before `ready`.
4. Other tabs: a `storage` listener refreshes the cache and fires `onExternalChange`, which
   `AppBootstrap` uses to re-fetch the Zustand stores.

### Encryption (AES-GCM) — what it is and is not
- Key: 256-bit, **non-extractable**, persisted in **IndexedDB** (`tf_keystore`), created
  atomically so two tabs can't create different keys. Ciphertext prefix `enc:v2:`.
- It is obfuscation against casual inspection of localStorage. It is NOT a defence against XSS
  or someone using the unlocked browser (the page itself can always decrypt).
- If IndexedDB/WebCrypto is unavailable (private mode) data is stored as plain JSON — never lost.
- Legacy `enc:v1:` data used a per-session key in sessionStorage; it is migrated only if that
  key is still alive in the tab, otherwise it is unrecoverable (it already was).

### Lessons (each one was a real, shipped bug — all verified with Playwright)
| Bug | Cause | Rule |
|-----|-------|------|
| Every browser restart wiped all tasks; every reload logged the user out | Key lived in `sessionStorage`; `localUser.get()` was sync but data was only decryptable async | Persist the key; hydrate everything up front; gate UI on `ready` |
| Tasks silently not saved | Zod schema said `description: string` but tasks use `null`; `set()` filtered through the schema and dropped them | Validate at trust boundaries (disk read, backup import), **never on write**; schemas must match the TS types (`.nullable()`) |
| New task not shown after capture, saved on disk | `fetchTasks` read the cache, awaited, then `set()` — a stale read overwrote a concurrent create | Read the cache in the same tick as `set()`: `await hydrateLocalStore(); set({tasks: localTasks.get()})` |
| Sign out immediately signed back in | `clear()` removed localStorage but not the cache | `removeValue` clears both |
| Drag-reorder under a filter deleted the hidden tasks | `reorderTasks(filteredSubset)` replaced the whole list | Put the subset back into the slots it occupied |
| `new Date("2026-11-17")` is UTC | Date-only strings shifted a day in negative-offset zones | `parseDate()` in `utils.ts` treats `yyyy-MM-dd` as a local day |

`AnyArray` (`any[]`) is the return type of the array helpers; a single `eslint-disable` sits on
that alias. Zod v4: use `z.ZodSafeParseSuccess<T>` (not `z.SafeParseSuccess`).

---

## Adding tasks (capture)

All entry points share one parser: `src/lib/task-parser.ts` (pure, EN + AR, unit-testable with
`node --experimental-strip-types`).

- Syntax: `#category` `!priority` (English or Arabic words) + date words (today, tomorrow,
  Friday, next week, in 3 days, 2026-12-31, اليوم، بكرة، بعد غد، الخميس، بعد ٣ أيام …). Times
  are deliberately left in the title (there is no time field in the UI). Unknown `#123` stays.
- Note: `\b` doesn't work for Arabic — the parser uses `(?<![\p{L}\p{N}])…(?![\p{L}\p{N}])`.
- **Quick add** (dashboard, `/` focuses it) shows a live "Will add as" preview.
- **Import list** (`ImportTasksModal`): paste Notes/Reminders text, one task per line; bullets,
  `1.`, `- [ ]` stripped, checked items skipped; pasting multiple lines into Quick add opens it.
- **Capture link** (`src/lib/capture.ts`, run by `AppBootstrap`):
  `<app>/dashboard/?add=TEXT[&priority=&due=&category=&notes=]`, newlines → several tasks,
  max 100. URL is cleaned right away (reload can't duplicate). If signed out, the query is
  stashed in sessionStorage and replayed after login. This is what Apple Shortcuts / Siri /
  bookmarklets call. `/capture` page documents the recipes with copyable links.
- `createTasks()` in the task store builds on the **persisted** list, so a capture fired right
  after page load can't overwrite existing tasks.
- iOS caveat (documented on the page): a Home-Screen web app has storage separate from Safari —
  Shortcuts opens Safari, so use the site in Safari.

## Telegram — two modes (`src/lib/telegram.ts`, `components/settings/TelegramCard.tsx`)

**Server mode (recommended, `telegram-bot/` on Vercel)** — the bot answers instantly 24/7, even
with the app closed. The server never stores the task list, only raw message text in a Redis
inbox until the app collects it. Flow: app `POST /api/pair` → `{code, inboxKey, bot}`; user sends
`/link CODE`; server binds `chat:<id>`↔`inboxKey` (+`linked:<key>`); messages `RPUSH inbox:<key>`;
app `GET /api/inbox` (Bearer inboxKey) → parses with the shared parser → creates tasks → then
`POST /api/inbox {count}` acks (at-least-once; an in-memory guard avoids duplicates if an ack
fails). Other endpoints: `/api/webhook` (secret-header checked), `/api/status` (public health, no
secrets), `/api/setup?key=<secret>` (registers the webhook for the deployment host — no manual
setWebhook). "New code" revokes the old code (`previousCode`); a linked chat can re-link and its
pending messages move to the new inbox. Pairing is rate limited (30/min), `/api/status` too (60/min); secrets are compared in constant time. The app's CSP allows
`https://*.vercel.app` only — a custom domain needs adding to `connect-src` (layout.tsx +
next.config.ts).
Deploy (Vercel): New Project → import this repo → **Root Directory `telegram-bot`** → env
`TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` (any long random string) → Storage → add
**Upstash Redis** and connect it (adds `KV_REST_API_URL/TOKEN` or `UPSTASH_REDIS_REST_*`) →
redeploy → open `https://<project>.vercel.app/api/setup?key=<secret>` once → paste the
`https://<project>.vercel.app` address in TaskFlow → Settings → Telegram → Connect server. Use the
production domain, not a preview URL (previews are behind Vercel Authentication).
Tested locally against fakes of Upstash REST and the Bot API running the real `api/*.ts`
(`tsc --strict` against `@vercel/node` types too). It has NOT been run on real Vercel/Upstash/
Telegram — the dev sandbox cannot reach them. If setup fails, `/api/status` and the app's
"Check connection" name the missing piece.

**Browser mode (no server)** — the browser calls
`api.telegram.org/bot<token>/getUpdates` directly (form-encoded POST = no CORS preflight).
- Pairing: Settings generates an 8-char code (15 min TTL); sending `/link CODE` (or the
  `?start=link_CODE` deep link) from Telegram stores that `chat_id`. Only that private chat is
  trusted; everyone else is ignored silently. Verified by test (stranger messages never import).
- Polling: 30 s when linked, 4 s while pairing, only when the tab is visible, one poller across
  tabs via Web Locks. Messages are held by Telegram for 24 h; tasks arrive while the app is open.
- Connecting calls `deleteWebhook` (getUpdates and webhooks are mutually exclusive) — this
  disables the legacy Vercel bot below.
- Token is stored encrypted in this browser only (key `tf_telegram`), excluded from backups.
- Offset is saved after tasks are created → at-least-once delivery.
- Forgiving input: `normalizeToken()` strips `< >`, quotes, whitespace and a `bot` prefix (people
  paste tokens as `<bot123:ABC>`). The token field is plain text on purpose so a stray character
  is visible. The bare 8-char code, `/link CODE` and `/start@bot link_CODE` all pair.
- Errors are classified (`TelegramError.kind`): 401/404 → "token not accepted, copy it again from
  @BotFather"; fetch failure → "can't reach api.telegram.org (VPN/ad-blocker/company network)";
  409 → the app deletes the leftover webhook itself and recovers on the next poll.
- While pairing, any private message that isn't the current code gets one helpful reply per poll
  (silence made a wrong/expired code look like a dead bot). After pairing, other chats are ignored.
- **Check connection** (Settings) runs getMe + getWebhookInfo (removing a leftover webhook) and
  reports linked/last-check — ask the user for this output before guessing.
- Polls also fire on `focus`/`pageshow`/`online` (returning from the Telegram app on a phone).
- Known limit of browser mode: nothing happens while TaskFlow isn't open in a visible tab — the bot
  can't reply and tasks wait at Telegram (24 h). Server mode removes that.
- Real api.telegram.org could not be reached from the dev sandbox, so Telegram tests use a mocked
  Bot API (401, 409, network abort, leftover webhook, two tabs, backlog while closed).

## Backup

Settings → Export/Import (`src/lib/backup.ts`): JSON with tasks/tags/habits/completions
(no token, no profile). Import validates each item and **merges by id** (existing wins).

---

## Tailwind v4 gotchas (cost us hours; hover styles were silently dead app-wide)
- Plain classes in `@layer utilities` get **no variants** (`hover:`, `/10` opacity). Theme
  colors are declared in `@theme inline` (`--color-primary: rgb(var(--primary))`, …) so
  `hover:bg-secondary`, `bg-accent`, `border-primary/40` work. Only `bg-base`/`border-base`
  remain custom.
- Component classes (`.card`, `.btn-*`, `.input-base`, `.glass`, `.badge`) live in
  `@layer components` so utilities like `pl-9`, `h-9`, `px-3` can override them. In
  `utilities` they won the cascade and e.g. a search icon overlapped its input text.
- `dark:` defaults to the OS setting; the app toggles `.dark` on `<html>`, so
  `@custom-variant dark (&:where(.dark, .dark *));` is required.
- Verify instead of assuming: grep the compiled CSS in `out/_next/static/chunks/*.css`.

## React / ESLint patterns
- `react-hooks/set-state-in-effect`: no synchronous `setState` in `useEffect`. Use lazy
  `useState(() => …)`, `useSyncExternalStore`, or set state from async callbacks/intervals.
- `Date.now()` in render is impure; keep "now" in state updated by an interval.
- Hydration-safe client-only values (e.g. the absolute capture URL): `useSyncExternalStore` with
  a `""` server snapshot.
- Theme: derive `resolvedTheme` inline; the effect only toggles the class.

## CI/CD (GitHub Pages)
- `actions/configure-pages@v5` must come **before** the build step (root cause of every early
  failure). Placeholder Supabase env vars satisfy the build. Free plan needs a **public** repo.
- Triggers: push to `main` and `claude/build-todo-app-BLpsC`, plus manual dispatch.
- `tsconfig.json` must exclude sub-projects with other toolchains (`telegram-bot`); it allows `.ts`
  import extensions for the Node-run tests. Workflow actions are on Node-24 majors (checkout v7,
  setup-node v7, configure-pages v6, upload-pages-artifact v5, deploy-pages v5) with Node 22.

## Security notes
- CSP is injected as a `<meta>` in `src/app/layout.tsx` — the single source of truth (headers() in
  next.config.ts is ignored with `output: "export"`, so it was removed). `connect-src` allows only
  `https://api.telegram.org` and `https://*.vercel.app`.
- No wildcard `remotePatterns`. Sign-out asks for confirmation (it clears the profile, not tasks).
- A capture link can add tasks (≤100 per link, text only, rendered escaped by React). That is
  the price of one-tap Shortcuts; nothing is read or deleted by links.
- Never paste PATs/bot tokens into chats — rotate any that were.

## How to verify (do this, don't trust the type checker)
1. `npm run lint && npm test && node_modules/.bin/next build`
   - `tests/unit/*.test.ts` use Node's built-in runner with `--experimental-strip-types` (so
     imports in tested files need explicit `.ts` and no `@/` alias; the parser is deliberately
     dependency-free). `bot-server.test.ts` stubs `fetch` with fakes of Upstash REST + the Bot API.
   - Run unit tests under several `TZ=` values when touching dates.
2. `npm run test:e2e` — `tests/e2e/run.mjs` serves `out/` under `/To-do-Abdulrahman-/`, starts the
   bot harness (`bot-harness.mts`: fake Redis + fake Telegram + the real `telegram-bot/api/*.ts`
   via `npx tsx`) and drives Chromium with Playwright using `launchPersistentContext(dir)` —
   closing and relaunching it is a real browser restart (a fresh context is NOT, it loses
   IndexedDB). Telegram is mocked with `page.route` (add `access-control-allow-origin: *`).
3. Take screenshots (light, dark, 390px mobile) — functional tests don't catch design bugs.
4. Type-check the Vercel functions strictly against `@vercel/node` (they are excluded from the
   Next tsconfig).

## Dates
Never build a day string with `toISOString()` (it is UTC; off by a day around midnight in UTC+3 and
for evenings in the Americas). Use `todayLocal()` / `formatLocalDate()` / `parseDate()`.

## Accessibility notes
Icon-only buttons need `aria-label`. Hover-revealed controls must also be visible on touch and on
focus: `opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100`.

---

## File map

```
src/
  app/
    (auth)/login, register      Name-only profile; wait for hydration before deciding
    (dashboard)/layout.tsx      Gate on useLocalUser().ready, mounts <AppBootstrap/>
      dashboard/                Stats, quick-add (+preview), filters, import, Pomodoro, tasks
      capture/                  "Add tasks from anywhere" guide (Shortcuts, Notes, Siri…)
      habits/ analytics/ settings/   Settings = profile, theme, Telegram, backup
  components/
    capture/                    ImportTasksModal, TaskPreviewChips
    settings/                   TelegramCard, BackupCard
    providers/                  ThemeProvider, AppBootstrap (load data, capture, Telegram poll)
    layout/ tasks/ analytics/ dashboard/ habits/ pomodoro/
  lib/
    local-store.ts              Encrypted, hydrated, write-through storage (see above)
    use-local-store.ts          useLocalUser / useTelegramConfig hooks
    task-parser.ts              EN/AR text → task fields
    capture.ts  telegram.ts  backup.ts  utils.ts
  store/                        Zustand: useTaskStore (createTasks, merge-safe reorder), useHabitStore
telegram-bot/                   Always-on bot server for Vercel: api/{webhook,pair,inbox,status,setup}.ts + lib/core.ts
tests/unit, tests/e2e           node:test suites (CI) and Playwright suites (manual)
```
