-- Telegram Integration Migration
-- Run this against your Supabase project to enable Telegram features

-- Add Telegram fields to user_profiles
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS telegram_chat_id BIGINT UNIQUE,
  ADD COLUMN IF NOT EXISTS telegram_link_token VARCHAR(64) UNIQUE;

-- Add source field to tasks (web | telegram)
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'web'
    CHECK (source IN ('web', 'telegram'));

-- Index for fast telegram_chat_id lookups
CREATE INDEX IF NOT EXISTS idx_user_profiles_telegram_chat_id
  ON public.user_profiles (telegram_chat_id);

-- Index for fast telegram_link_token lookups
CREATE INDEX IF NOT EXISTS idx_user_profiles_telegram_link_token
  ON public.user_profiles (telegram_link_token);
