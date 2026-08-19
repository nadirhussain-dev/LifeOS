-- ---------------------------------------------------------------------------
-- 0062 — Recurring transactions.
--
-- Rent, subscriptions and salary are known in advance, and re-entering them
-- every month is the chore that makes people stop entering anything at all.
--
-- ## Materialized, not virtual
--
-- Occurrences are written into `budget_transactions` rather than computed on
-- read. A budget is a ledger: the rows have to be editable, deletable and
-- searchable like any other, and a virtual row that changes retroactively when a
-- rule is edited is not a record of anything. It also means every existing
-- report, chart and export sees recurring spending with no changes at all.
--
-- ## Which makes double-posting the whole risk
--
-- Two devices coming online after a fortnight both compute the same catch-up,
-- and billing someone's rent twice in their own records is the kind of bug that
-- loses trust permanently. Two independent guards:
--
--   1. `last_posted_date` is a high-water mark, and `dueOccurrences` never
--      returns a date at or before it. A rule whose cadence is later edited
--      therefore does not re-post its history.
--   2. Every written transaction carries a *derived* id,
--      `recurring:<ruleId>:<yyyy-MM-dd>`, so even if a mark somehow lagged, the
--      second write is the same primary key and the upsert collapses it.
--
-- The second guard is the one that survives a bug in the first, which is why
-- both exist.
--
-- ## `anchor_date` is kept, not consumed
--
-- Occurrences are indexed from the anchor rather than stepped from the previous
-- one, because stepping compounds a month-end clamp: rent anchored on the 31st
-- becomes 28 February and then the 28th of every month forever after. Indexing
-- re-derives each occurrence from the original day-of-month, so the same rule
-- gives 31 Jan, 28 Feb, 31 Mar. The anchor is the only record of that
-- day-of-month, so it is never overwritten.
--
-- Same four contracts as 0057, 0058 and 0061.
-- ---------------------------------------------------------------------------

create table if not exists public.budget_recurring (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null,
  amount_cents bigint not null,
  category text not null,
  account text not null default 'cash',
  note text,
  frequency text not null,
  interval bigint not null default 1,
  anchor_date text not null,
  last_posted_date text,
  is_active bigint not null default 1,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint
);

alter table public.budget_recurring enable row level security;

drop policy if exists "budget_recurring_own" on public.budget_recurring;
create policy "budget_recurring_own" on public.budget_recurring
  for all
  using (
    user_id = (select auth.uid())
    and (select public.may_access_own_data())
  )
  with check (
    user_id = (select auth.uid())
    and (select public.may_access_own_data())
  );

create index if not exists budget_recurring_sync_idx
  on public.budget_recurring (user_id, updated_at);

-- --- the operator whitelist, extended ---------------------------------------

create or replace function public.operator_readable_tables()
returns text[]
language sql
immutable
as $$
  select array[
    'task_categories', 'tasks', 'task_subtasks', 'task_tag_links',
    'note_categories', 'notes', 'note_tags', 'note_tag_links', 'note_attachments',
    'entry_links',
    'habit_categories', 'habits', 'habit_routines', 'habit_routine_items',
    'habit_logs', 'habit_skips',
    'journal_entries', 'journal_prompts', 'journal_reflections', 'journal_attachments',
    'calendar_events',
    'goals', 'goal_milestones', 'goal_progress_logs',
    'sleep_sessions', 'sleep_settings',
    'study_subjects', 'study_sessions', 'study_settings',
    'water_intake_logs',
    'budget_transactions', 'budget_category_limits', 'budget_recurring',
    'savings_goals', 'budget_debts', 'budget_settings',
    'gallery_albums', 'gallery_photos',
    'songs', 'playlists', 'playlist_songs',
    'private_entries'
  ];
$$;
