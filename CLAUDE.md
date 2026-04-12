# TaskFlow — CLAUDE.md

Project knowledge base for AI-assisted development. Every decision, bug, fix, and
pattern discovered during this project is recorded here.

---

## Project Overview

**TaskFlow** is a local-first productivity app built with Next.js 16 and deployed as
a static site on GitHub Pages. It includes task management, habit tracking, a Pomodoro
timer, analytics, and a Telegram bot integration.

Live URL: `https://abdualhumud.github.io/To-do-Abdulrahman-/`
Branch:   `claude/build-todo-app-BLpsC`

---

## Architecture Decisions

### Local-first / No Database

The app stores all data exclusively in the browser's `localStorage`. There is no
backend, no Supabase account required at runtime, and no user authentication server.
This means:

- Zero running costs and zero API keys required for normal use
- All data is private to the user's device
- Supabase packages remain in `package.json` but are never called at runtime —
  placeholder env vars satisfy the build
- Realtime subscription methods in the Zustand stores are no-ops

### Static Export for GitHub Pages

`next.config.ts` sets `output: "export"`. This produces a fully static `./out`
directory that GitHub Pages can serve directly.

Critical settings:
```ts
output: "export",
basePath: "/To-do-Abdulrahman-",   // must match the repo name
trailingSlash: true,
images: { unoptimized: true },     // next/image cannot optimize on static export
```

`basePath` is required so that all asset paths and client-side routes are prefixed
with `/To-do-Abdulrahman-/`. Without it, navigation works on the index page but
breaks on direct deep-links.

---

## Data Layer — `src/lib/local-store.ts`

This is the most important file in the project.

### Encryption

All data written to localStorage is encrypted with **AES-GCM 256-bit**.

- The encryption key is generated once per session and stored in `sessionStorage`
  (cleared automatically when the tab closes)
- On subsequent page loads the key is re-imported from `sessionStorage`
- Values are prefixed with `"enc:v1:"` to distinguish encrypted from legacy plain JSON
- If `crypto.subtle` is unavailable (HTTP, old browser) the code falls back to plain JSON
- The key is stored as JWK; use `crypto.subtle.importKey("jwk", ...)` to restore it

### Write-through Cache — the most important design pattern

**Problem:** After any write the localStorage value is encrypted (async). On the
next synchronous read (`readSync`) the code saw an `"enc:v1:"` prefix and correctly
returned the fallback (empty array) instead of corrupted data — but this caused
every page reload to start with empty task/habit lists.

**Solution:** A write-through in-memory `Map` called `_memCache`:

```ts
const _memCache = new Map<string, unknown>();

function writeAsync(key: string, value: unknown): void {
  _memCache.set(key, value);          // synchronous — readSync sees this immediately
  encryptAndWrite(key, value).catch(/* fallback sync write */);
}

function readSync<T>(key: string, fallback: T): T {
  if (_memCache.has(key)) return _memCache.get(key) as T;  // always wins
  // ...parse plain JSON for legacy, return fallback for encrypted
}
```

On page reload (cold start) the cache is empty. Callers that need data after reload
MUST use `getAsync()` (decrypts from localStorage). Zustand store `fetch*` actions
call `getAsync()` on mount — this populates the cache and the sync path works fine
for the rest of the session.

### Zod Validation (Zod v4 API)

All reads are validated before use to prevent corrupted/injected data.

**Zod v4 breaking change:** The success type is `z.ZodSafeParseSuccess<T>`, NOT
`z.SafeParseSuccess<T>`. Using the wrong one causes a TypeScript build error.

```ts
// CORRECT (Zod v4)
.filter((r): r is z.ZodSafeParseSuccess<T> => r.success)

// WRONG (Zod v3 — does not exist in v4)
.filter((r): r is z.SafeParseSuccess<T> => r.success)
```

Use `.passthrough()` on schemas for types that have extra fields not declared in the
schema — otherwise Zod strips them silently.

### `AnyArray` type alias

The `get()` and `getAsync()` helpers return `any[]` because the Zod schemas validate
a subset of the full TypeScript interface fields. Returning the concrete type
(`Task[]`) would require full schema parity.

To avoid the ESLint `@typescript-eslint/no-explicit-any` error on the return type
annotation, use a named alias:

```ts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyArray = any[];
```

One disable comment, applied to the alias definition, suppresses the error across
all uses of the type.

---

## Zustand Stores

### `src/store/useTaskStore.ts`

- `fetchTasks()` and `fetchTags()` use `await localTasks.getAsync()` / `await localTags.getAsync()`
  — this is intentional and critical for decrypting data on page load
- `subscribeToRealtime` and `unsubscribeFromRealtime` are present for interface
  compatibility but are no-ops
- `getFilteredTasks()` is a derived selector (no async) — safe to call anywhere

**Search filter null-safety:** Task descriptions can be `null`. Always use optional
chaining with a `?? false` fallback to avoid `TypeError`:

```ts
// SAFE
!(task.description?.toLowerCase().includes(q) ?? false)

// UNSAFE — throws when description is null
!task.description?.toLowerCase().includes(q)
```

### `src/store/useHabitStore.ts`

Same pattern: `fetchHabits()` uses `getAsync()` for both habits and completions.

---

## React Patterns

### ESLint rule: `react-hooks/set-state-in-effect`

Never call `setState` inside `useEffect`. This rule is enforced and will fail CI.

**Wrong:**
```tsx
useEffect(() => {
  const user = localUser.get();
  setUser(user);              // ← setState inside effect: lint error
}, []);
```

**Correct:** Use lazy `useState` initializer instead:
```tsx
const [user] = useState<LocalUser | null>(() => localUser.get());

useEffect(() => {
  if (!user) router.replace("/login");
}, [user, router]);
```

The lazy initializer runs once during hydration. The effect only performs
side-effects (navigation, DOM mutations) — never state updates.

### ESLint rule: `react-hooks/immutability`

Functions called inside `useEffect` must be declared before the effect or be stable
(wrapped in `useCallback`). Define helper functions outside the component, or use
the pattern above to avoid functions in effects entirely.

### ThemeProvider Pattern

Derive values inline instead of storing derived state:

```tsx
// Derived inline — no useState for resolvedTheme, no setState in effect
const resolvedTheme = getResolved(theme);

useEffect(() => {
  document.documentElement.classList.toggle("dark", resolvedTheme === "dark");
}, [resolvedTheme]);
```

This eliminates the stale-closure problem and satisfies the ESLint hooks rules.

### Auth Guard in Layout

```tsx
const initialUser = localUser.get();   // runs during render — before hydration
const [user] = useState<LocalUser | null>(initialUser);

useEffect(() => {
  if (!user) router.replace("/login");
}, [user, router]);

if (!user) return <Spinner />;         // prevents flash of protected content
```

No `useEffect` setState needed. The spinner prevents layout flicker while the
router redirect is processing.

---

## GitHub Actions CI/CD

### Workflow file: `.github/workflows/deploy.yml`

**Most critical lesson:** `actions/configure-pages@v5` MUST appear BEFORE the build
step. Without it the workflow silently fails — the "Setup Pages" token is never
issued, the upload step fails, and the deploy step never runs. This was the root
cause of all CI failures in this project.

```yaml
- name: Setup Pages              # ← MUST be before build
  uses: actions/configure-pages@v5
  with:
    static_site_generator: next

- name: Install dependencies
  run: npm ci

- name: Build
  env:
    NEXT_PUBLIC_SUPABASE_URL: https://placeholder.supabase.co
    NEXT_PUBLIC_SUPABASE_ANON_KEY: placeholder
  run: npm run build
```

### Placeholder env vars for build

The Supabase env vars are required at build time by the Next.js compiler even though
they are never used at runtime. Use placeholder strings — the build will succeed and
the app will work correctly.

### Branch triggers

The workflow is triggered on pushes to both `main` and the active feature branch
(`claude/build-todo-app-BLpsC`). Add new feature branches to the `branches:` list
if you want CI to run on push.

### GitHub Pages requires a public repository

On the free GitHub plan, GitHub Pages only works with public repositories. If the
repo is private, the Pages deployment job will silently fail or return a 404.

To make the repo public via API:
```bash
curl -X PATCH \
  -H "Authorization: token YOUR_PAT" \
  -H "Content-Type: application/json" \
  https://api.github.com/repos/OWNER/REPO \
  -d '{"private": false}'
```

---

## TypeScript / tsconfig

### Exclude non-Next.js directories

The `**/*.ts` glob in `tsconfig.json` includes everything under the repo root. Any
sub-project that uses its own type definitions (Deno, Vercel Node) must be explicitly
excluded:

```json
"exclude": ["node_modules", "supabase/functions", "telegram-bot"]
```

If you forget, the Next.js tsc pass will try to compile those files and fail because
the external packages aren't in `node_modules`.

---

## Security

### Content Security Policy

HTTP response headers are useless on GitHub Pages (static file server). Instead,
inject a `<meta http-equiv="Content-Security-Policy">` tag in `src/app/layout.tsx`.
Keep it in sync with the `next.config.ts` headers (which apply when running
`next start` locally).

Key CSP directives for Next.js static export:
- `script-src 'self' 'unsafe-inline'` — required by Next.js inline scripts
- `style-src 'self' 'unsafe-inline'` — required by Tailwind
- `connect-src 'self' https://api.telegram.org` — add any external API domains here
- `frame-ancestors 'none'` — prevents clickjacking
- `object-src 'none'` — disables Flash/plugins

### Wildcard image hostnames

Never use `hostname: "**"` in `next.config.ts` `remotePatterns`. It whitelists all
image proxying and is flagged as a security vulnerability. List specific trusted
domains instead:

```ts
remotePatterns: [
  { protocol: "https", hostname: "avatars.githubusercontent.com" },
  { protocol: "https", hostname: "lh3.googleusercontent.com" },
]
```

### Logout confirmation

Always show a confirmation dialog before clearing localStorage. A single misclick
would destroy all user data with no way to recover. The `Header` component
implements a two-step logout: first click shows a confirmation modal, second click
calls `localUser.clear()` and navigates to `/login`.

### Telegram webhook signature verification

The `telegram-bot/api/webhook.ts` handler checks the `X-Telegram-Bot-Api-Secret-Token`
header against the `TELEGRAM_WEBHOOK_SECRET` env var. Set this when calling
`setWebhook` with the `secret_token` parameter. Without it, anyone who discovers
the webhook URL can POST fake updates.

---

## Bug Fixes Reference

| Location | Bug | Fix |
|----------|-----|-----|
| `local-store.ts` | Encrypted data returned empty array on every page reload | Write-through `_memCache`; stores call `getAsync()` on mount |
| `useTaskStore.ts` | `TypeError` when searching tasks with null description | `!(desc?.includes(q) ?? false)` instead of `!desc?.includes(q)` |
| `WeeklyHeatmap.tsx` | All 4 weeks showed identical data | `w===0?0:0` tautology; fixed to `w===0 ? today : addDays(weekStart,6)` |
| `ThemeProvider.tsx` | ESLint `set-state-in-effect` + `immutability` errors | Derive `resolvedTheme` inline; effect only toggles CSS class |
| `(dashboard)/layout.tsx` | ESLint `set-state-in-effect` | Lazy `useState(() => localUser.get())` |
| `settings/page.tsx` | ESLint `set-state-in-effect` | Lazy `useState(() => localUser.get()?.name ?? "")` |
| `deploy.yml` | CI always failed (all 4 runs) | Missing `actions/configure-pages@v5` before build step |
| `tsconfig.json` | Build failed: `Cannot find module '@vercel/node'` | Added `"telegram-bot"` to `exclude` list |
| `Sidebar.tsx` | Unused import lint errors | Removed `useState` and `Plus` imports |
| `TaskModal.tsx` | Unused import lint error | Removed `TagIcon` import |

---

## Telegram Bot Integration

### Architecture

Since the app is localStorage-only, there is no shared backend between the web app
and the Telegram bot. They operate as independent systems.

- **Web app** (`settings/page.tsx`): Shows a "Connect Telegram" card with a button
  that opens `https://t.me/{BOT_USERNAME}`. The button only renders when
  `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` is set.
- **Bot webhook** (`telegram-bot/api/webhook.ts`): A standalone Vercel serverless
  function. Handles text commands and stores tasks per chat ID.

### Storage

The webhook uses Upstash Redis when `UPSTASH_REDIS_REST_URL` and
`UPSTASH_REDIS_REST_TOKEN` are set. If not, it falls back to an in-process `Map`
(data survives only while the serverless instance is warm — fine for demos, not for
production).

### Setup Steps

1. Create a bot with [@BotFather](https://t.me/BotFather) → copy the token
2. Add `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` to GitHub Secrets → redeploy the web app
3. Deploy `telegram-bot/` to Vercel with env vars:
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_WEBHOOK_SECRET` (any random string)
4. Register the webhook once:
   ```
   https://api.telegram.org/bot<TOKEN>/setWebhook
     ?url=https://your-app.vercel.app/api/webhook
     &secret_token=<YOUR_SECRET>
   ```

### Bot Commands

| Input | Action |
|-------|--------|
| `/start` | Welcome message with instructions |
| Any text | Creates a new task with smart parsing |
| `/tasks` | Lists pending tasks |
| `/done N` | Marks task #N as complete |
| `/clear` | Removes all completed tasks |

**Smart text parsing:**
```
Buy groceries tomorrow at 6pm #personal !high
  → title="Buy groceries", due="tomorrow", category="personal", priority="high"
```

Supported date keywords: `today`, `tomorrow`, `next week`, `in N days`, day names
(`monday`–`sunday`). Supported priority flags: `!low`, `!medium`, `!high`, `!urgent`.

---

## Dependency Notes

| Package | Notes |
|---------|-------|
| `next` 16.1.6 | Requires `output:"export"` for GitHub Pages |
| `zod` ^4.3.6 | v4 API — use `z.ZodSafeParseSuccess<T>`, NOT `z.SafeParseSuccess<T>` |
| `zustand` ^5.0.11 | v5 API — `create<Store>()` (no separate `StoreState` split needed) |
| `date-fns` ^4.1.0 | v4 API — imports are direct named exports, no namespace |
| `tailwindcss` ^4 | v4 config — uses `@theme` in CSS instead of `tailwind.config.js` |
| `eslint-config-next` 16.1.6 | Enforces `react-hooks/set-state-in-effect` and `immutability` |
| `@supabase/supabase-js` | Present in `package.json` but never called at runtime |

---

## File Map

```
src/
  app/
    (auth)/               Login / register pages
    (dashboard)/
      layout.tsx          Auth guard + shell layout
      dashboard/          Overview page
      tasks/              Task list + CRUD
      habits/             Habit tracker
      analytics/          Charts and heatmap
      settings/           Profile, theme, Telegram link
      pomodoro/           Pomodoro timer
    layout.tsx            Root layout (CSP meta, ThemeProvider)
  components/
    layout/
      Header.tsx          Top bar + logout confirmation dialog
      Sidebar.tsx         Navigation
    tasks/
      TaskCard.tsx        Individual task row
      TaskList.tsx        Virtualized task list
      TaskModal.tsx       Create / edit task drawer
      FilterBar.tsx       Status / priority / search filters
    analytics/
      WeeklyHeatmap.tsx   GitHub-style completion heatmap
    providers/
      ThemeProvider.tsx   Light / dark / system theme context
  store/
    useTaskStore.ts       Zustand store — tasks and tags
    useHabitStore.ts      Zustand store — habits and completions
  lib/
    local-store.ts        AES-GCM encrypted localStorage wrappers
    utils.ts              cn() helper (clsx + tailwind-merge)
telegram-bot/
  api/webhook.ts          Vercel serverless webhook handler
  vercel.json             Vercel project config
  setup-webhook.sh        One-shot webhook registration script
supabase/functions/       Dead code — kept for reference; not deployed
.github/workflows/
  deploy.yml              CI/CD — build → upload → deploy to GitHub Pages
```
