# TaskFlow — Personal Productivity System

A comprehensive, modern, and highly functional Personal Todo List Web Application built as a full productivity powerhouse. Not just a list — a complete personal task management system.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Framework** | Next.js 14 (App Router) + TypeScript |
| **Styling** | Tailwind CSS v4 + Custom CSS Variables |
| **Auth & DB** | Supabase (PostgreSQL + Auth) |
| **Email** | Resend |
| **Charts** | Recharts |
| **Drag & Drop** | @dnd-kit |
| **State** | Zustand |
| **Animations** | Framer Motion + CSS |

## Features

### Core Task Management
- **CRUD Operations** — Create, Read, Update, Delete tasks with full details
- **Priority Levels** — Low, Medium, High, Urgent with visual color indicators
- **Categories** — Work, Personal, Health, Learning, Finance, Social, Other
- **Custom Tags** — Create and assign color-coded tags to tasks
- **Sub-tasks** — Break down complex tasks into smaller steps with checkboxes
- **Due Dates** — Set deadlines with overdue/today visual alerts
- **Status Tracking** — Pending, In Progress, Completed, Cancelled

### Productivity Features
- **Drag & Drop Reordering** — Reorder tasks with smooth animations via @dnd-kit
- **Keyboard Shortcuts** — Press `N` to create a new task instantly
- **Smart Filters** — Filter by status, priority, category, tags, or search text
- **Progress Analytics** — 7-day area charts, category pie charts, priority bar charts, activity heatmap

### Habit Tracker
- Create daily/weekly habits with custom icons and colors
- One-click daily completion tracking
- Streak calculation and 7-day visual history
- Overall daily progress bar

### Pomodoro Timer
- 25min focus / 5min short break / 15min long break modes
- Circular progress indicator
- Session counter
- Auto-logs completed sessions to Supabase

### Daily Email Reports
- **Automated digest** powered by Resend
- Shows: tasks completed today, due tomorrow, overdue tasks
- Includes productivity score with color-coded feedback
- Beautiful HTML email template
- **Manual "Send Now" button** in the dashboard
- Configurable send time in settings

### UI/UX
- **Dark / Light / System** theme toggle (persisted in localStorage)
- Responsive design — works perfectly on mobile and desktop
- Mobile bottom navigation
- Glass morphism effects
- Smooth CSS animations and transitions
- Custom scrollbar styling

## Setup

### 1. Clone and install

```bash
git clone <repo-url>
cd taskflow
npm install
```

### 2. Configure environment variables

```bash
cp .env.local.example .env.local
```

Fill in your credentials:

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
RESEND_API_KEY=your_resend_api_key
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### 3. Set up Supabase

1. Create a new project at [supabase.com](https://supabase.com)
2. Run the SQL schema from `supabase/schema.sql` in the Supabase SQL Editor
3. Enable Email Auth in Authentication → Providers

### 4. Set up Resend

1. Create account at [resend.com](https://resend.com)
2. Create an API key
3. Verify your sending domain (or use `onboarding@resend.dev` for testing)
4. Update the `from` field in `/src/app/api/reports/send/route.ts`

### 5. Run locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Project Structure

```
src/
├── app/
│   ├── (auth)/           # Login & Register pages
│   ├── (dashboard)/      # Protected dashboard routes
│   │   ├── dashboard/    # Main task management view
│   │   ├── analytics/    # Charts & productivity insights
│   │   ├── habits/       # Habit tracker
│   │   └── settings/     # User settings
│   ├── api/
│   │   └── reports/send/ # Email report API endpoint
│   ├── globals.css        # Theme variables & utilities
│   └── layout.tsx
├── components/
│   ├── analytics/        # Chart components (Recharts)
│   ├── dashboard/        # Stats cards, send report button
│   ├── habits/           # Habit card & modal
│   ├── layout/           # Sidebar & Header
│   ├── pomodoro/         # Pomodoro timer
│   ├── providers/        # Theme context provider
│   └── tasks/            # Task card, list, modal, filters
├── lib/
│   └── supabase/         # Client, server, proxy utils
├── store/
│   ├── useTaskStore.ts   # Zustand store for tasks
│   └── useHabitStore.ts  # Zustand store for habits
└── types/                # TypeScript interfaces
supabase/
└── schema.sql            # Full database schema with RLS
```

## Database Schema

- `user_profiles` — Extended user data, email preferences
- `tasks` — Core tasks with priority, category, status, due date
- `task_tags` — Many-to-many junction for task-tag relationships
- `tags` — User-defined color-coded tags
- `subtasks` — Task sub-items with ordering
- `habits` — Daily/weekly habit definitions
- `habit_completions` — Per-day completion records with streak support
- `pomodoro_sessions` — Timer session logs

All tables have Row Level Security (RLS) ensuring users can only access their own data.

## Deployment

Deploy to Vercel with one click:

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new)

Set all environment variables in the Vercel dashboard before deploying.
