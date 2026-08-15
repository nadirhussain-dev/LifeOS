-- Daykeep — initial Supabase schema for sync (v1)
--
-- Run this in your Supabase project's SQL editor (or via the Supabase CLI).
-- It creates a `profiles` table (auto-populated on sign-up) plus the v1 sync
-- tables that mirror the local SQLite schema. Every table has Row Level
-- Security so a user can only ever read/write their own rows (user_id =
-- auth.uid()).
--
-- Column types mirror the on-device SQLite storage exactly so the sync engine
-- can push/pull raw rows without any per-column mapping: TEXT -> text,
-- INTEGER -> bigint (timestamps are epoch-ms; booleans are 0/1), REAL ->
-- double precision. `user_id` is uuid (references the authenticated user).
-- Foreign keys between app tables are intentionally omitted — the device is the
-- source of truth and pushes parents/children in dependency order.
--
-- v1 syncs each module's primary records. Child/log tables (habit logs, note
-- tags, goal milestones, journal reflections, per-module settings rows,
-- attachments) and media modules (gallery, music) are not synced yet — see
-- TODO.md.

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  created_at bigint,
  updated_at bigint
);

alter table public.profiles enable row level security;

create policy "profiles_own" on public.profiles
  for all using (id = auth.uid()) with check (id = auth.uid());

-- Auto-create a profile row when a new auth user signs up, copying the
-- display_name passed in sign-up metadata.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, new.raw_user_meta_data ->> 'display_name')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Sync tables (mirror of the local SQLite schema)
-- ---------------------------------------------------------------------------

create table if not exists public.task_categories (
  id text primary key,
  user_id uuid not null,
  name text NOT NULL,
  color_token text NOT NULL,
  icon text NOT NULL,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL,
  deleted_at bigint
);
alter table public.task_categories enable row level security;
create policy "task_categories_own" on public.task_categories
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists public.tasks (
  id text primary key,
  user_id uuid not null,
  title text NOT NULL,
  notes text,
  status text NOT NULL DEFAULT 'todo',
  priority text NOT NULL DEFAULT 'none',
  category_id text,
  due_date bigint,
  has_due_time bigint NOT NULL DEFAULT 0,
  recurrence_frequency text NOT NULL DEFAULT 'none',
  recurrence_parent_id text,
  completed_at bigint,
  position bigint NOT NULL DEFAULT 0,
  reminder_enabled bigint NOT NULL DEFAULT 0,
  reminder_notification_id text,
  source_note_id text,
  habit_id text,
  habit_log_date text,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL,
  deleted_at bigint,
  sync_status text NOT NULL DEFAULT 'pending',
  server_updated_at bigint
);
alter table public.tasks enable row level security;
create policy "tasks_own" on public.tasks
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists public.note_categories (
  id text primary key,
  user_id uuid not null,
  name text NOT NULL,
  color_token text NOT NULL,
  icon text NOT NULL,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL,
  deleted_at bigint
);
alter table public.note_categories enable row level security;
create policy "note_categories_own" on public.note_categories
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists public.notes (
  id text primary key,
  user_id uuid not null,
  title text NOT NULL DEFAULT '',
  body text,
  category_id text,
  is_pinned bigint NOT NULL DEFAULT 0,
  is_archived bigint NOT NULL DEFAULT 0,
  word_count bigint NOT NULL DEFAULT 0,
  reminder_at bigint,
  reminder_notification_id text,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL,
  deleted_at bigint,
  sync_status text NOT NULL DEFAULT 'pending',
  server_updated_at bigint
);
alter table public.notes enable row level security;
create policy "notes_own" on public.notes
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists public.habit_categories (
  id text primary key,
  user_id uuid not null,
  name text NOT NULL,
  color_token text NOT NULL,
  icon text NOT NULL,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL,
  deleted_at bigint
);
alter table public.habit_categories enable row level security;
create policy "habit_categories_own" on public.habit_categories
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists public.habits (
  id text primary key,
  user_id uuid not null,
  name text NOT NULL,
  emoji text,
  category_id text,
  color_token text,
  type text NOT NULL DEFAULT 'boolean',
  unit text,
  target_value double precision,
  schedule_type text NOT NULL DEFAULT 'daily',
  schedule_days text,
  schedule_interval_days bigint,
  reminder_time text,
  reminder_adaptive bigint NOT NULL DEFAULT 0,
  reminder_notification_id text,
  position bigint NOT NULL DEFAULT 0,
  is_archived bigint NOT NULL DEFAULT 0,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL,
  deleted_at bigint,
  sync_status text NOT NULL DEFAULT 'pending',
  server_updated_at bigint
);
alter table public.habits enable row level security;
create policy "habits_own" on public.habits
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists public.habit_routines (
  id text primary key,
  user_id uuid not null,
  name text NOT NULL,
  position bigint NOT NULL DEFAULT 0,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL,
  deleted_at bigint
);
alter table public.habit_routines enable row level security;
create policy "habit_routines_own" on public.habit_routines
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists public.journal_entries (
  id text primary key,
  user_id uuid not null,
  entry_date text NOT NULL,
  body text NOT NULL DEFAULT '',
  mood text,
  energy bigint,
  stress bigint,
  focus bigint,
  sleep_hours double precision,
  sleep_quality bigint,
  mood_reasons text,
  location_label text,
  location_lat double precision,
  location_lng double precision,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL,
  deleted_at bigint,
  sync_status text NOT NULL DEFAULT 'pending',
  server_updated_at bigint
);
alter table public.journal_entries enable row level security;
create policy "journal_entries_own" on public.journal_entries
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists public.calendar_events (
  id text primary key,
  user_id uuid not null,
  title text NOT NULL,
  start_at bigint NOT NULL,
  end_at bigint,
  color_token text,
  notes text,
  reminder_minutes_before bigint,
  reminder_notification_id text,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL,
  deleted_at bigint
);
alter table public.calendar_events enable row level security;
create policy "calendar_events_own" on public.calendar_events
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists public.goals (
  id text primary key,
  user_id uuid not null,
  title text NOT NULL,
  description text,
  category text NOT NULL DEFAULT 'personal',
  category_label text,
  priority text NOT NULL DEFAULT 'medium',
  status text NOT NULL DEFAULT 'active',
  progress_mode text NOT NULL DEFAULT 'percent',
  manual_progress double precision NOT NULL DEFAULT 0,
  target_value double precision,
  current_value double precision NOT NULL DEFAULT 0,
  unit text,
  due_date bigint,
  completed_at bigint,
  position bigint NOT NULL DEFAULT 0,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL,
  deleted_at bigint,
  sync_status text NOT NULL DEFAULT 'pending',
  server_updated_at bigint
);
alter table public.goals enable row level security;
create policy "goals_own" on public.goals
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists public.sleep_sessions (
  id text primary key,
  user_id uuid not null,
  log_date text NOT NULL,
  bedtime bigint NOT NULL,
  wake_time bigint NOT NULL,
  duration_minutes bigint NOT NULL,
  fell_asleep_minutes bigint,
  quality bigint,
  note text,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL,
  deleted_at bigint,
  sync_status text NOT NULL DEFAULT 'pending',
  server_updated_at bigint
);
alter table public.sleep_sessions enable row level security;
create policy "sleep_sessions_own" on public.sleep_sessions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists public.study_subjects (
  id text primary key,
  user_id uuid not null,
  name text NOT NULL,
  color_token text NOT NULL,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL,
  deleted_at bigint
);
alter table public.study_subjects enable row level security;
create policy "study_subjects_own" on public.study_subjects
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists public.budget_transactions (
  id text primary key,
  user_id uuid not null,
  type text NOT NULL,
  amount_cents bigint NOT NULL,
  category text NOT NULL,
  account text NOT NULL DEFAULT 'cash',
  note text,
  occurred_at bigint NOT NULL,
  log_date text NOT NULL,
  savings_goal_id text,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL,
  deleted_at bigint,
  sync_status text NOT NULL DEFAULT 'pending',
  server_updated_at bigint
);
alter table public.budget_transactions enable row level security;
create policy "budget_transactions_own" on public.budget_transactions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists public.savings_goals (
  id text primary key,
  user_id uuid not null,
  name text NOT NULL,
  target_cents bigint NOT NULL,
  color_token text NOT NULL,
  deadline bigint,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL,
  deleted_at bigint
);
alter table public.savings_goals enable row level security;
create policy "savings_goals_own" on public.savings_goals
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists public.budget_debts (
  id text primary key,
  user_id uuid not null,
  direction text NOT NULL,
  counterparty text NOT NULL,
  principal_cents bigint NOT NULL,
  paid_cents bigint NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT '$',
  note text,
  due_date bigint,
  reminder_days_before bigint,
  reminder_notification_id text,
  settled_at bigint,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL,
  deleted_at bigint,
  sync_status text NOT NULL DEFAULT 'pending',
  server_updated_at bigint
);
alter table public.budget_debts enable row level security;
create policy "budget_debts_own" on public.budget_debts
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Indexes — every sync pull is WHERE user_id = ? AND updated_at > ?; without
-- these it's a sequential scan per table per sync. Idempotent.
-- ---------------------------------------------------------------------------
create index if not exists idx_task_categories_sync on public.task_categories(user_id, updated_at);
create index if not exists idx_tasks_sync on public.tasks(user_id, updated_at);
create index if not exists idx_note_categories_sync on public.note_categories(user_id, updated_at);
create index if not exists idx_notes_sync on public.notes(user_id, updated_at);
create index if not exists idx_habit_categories_sync on public.habit_categories(user_id, updated_at);
create index if not exists idx_habits_sync on public.habits(user_id, updated_at);
create index if not exists idx_habit_routines_sync on public.habit_routines(user_id, updated_at);
create index if not exists idx_journal_entries_sync on public.journal_entries(user_id, updated_at);
create index if not exists idx_calendar_events_sync on public.calendar_events(user_id, updated_at);
create index if not exists idx_goals_sync on public.goals(user_id, updated_at);
create index if not exists idx_sleep_sessions_sync on public.sleep_sessions(user_id, updated_at);
create index if not exists idx_study_subjects_sync on public.study_subjects(user_id, updated_at);
create index if not exists idx_budget_transactions_sync on public.budget_transactions(user_id, updated_at);
create index if not exists idx_savings_goals_sync on public.savings_goals(user_id, updated_at);
create index if not exists idx_budget_debts_sync on public.budget_debts(user_id, updated_at);
