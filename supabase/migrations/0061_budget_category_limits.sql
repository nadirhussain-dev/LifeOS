-- ---------------------------------------------------------------------------
-- 0061 — Per-category spending caps.
--
-- A monthly total tells you that you overspent. It does not tell you where,
-- which is the only version of that information anybody can act on — so
-- `budget_settings.monthly_budget_cents` gets a companion table with one row
-- per capped expense category.
--
-- ## The derived id, again
--
-- `userId:category`, the same convention 0016 gave the join tables and 0058
-- reused. Two devices that cap Food offline both compute the same id, so the
-- upsert collapses them. A random id would leave two caps for one category and
-- nothing to decide which the app should believe — and unlike a duplicated tag,
-- a duplicated budget silently changes a number the user is making decisions
-- against.
--
-- ## Absent is not zero
--
-- There is no row for an uncapped category, and that is load-bearing. A cap of
-- zero means "I intend to spend nothing here" and must render as over budget
-- the moment anything is spent; an absent row means this feature has no opinion
-- about the category. Storing uncapped categories as zero would collapse the
-- two and make the first inexpressible, which is why removing a cap is a
-- soft delete rather than a write of 0.
--
-- Same four contracts as 0057 and 0058: cascade in the CREATE, the 0017/0019
-- policy shape, the sync index, and a place on the operator whitelist.
-- ---------------------------------------------------------------------------

create table if not exists public.budget_category_limits (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null,
  limit_cents bigint not null,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint
);

alter table public.budget_category_limits enable row level security;

drop policy if exists "budget_category_limits_own" on public.budget_category_limits;
create policy "budget_category_limits_own" on public.budget_category_limits
  for all
  using (
    user_id = (select auth.uid())
    and (select public.may_access_own_data())
  )
  with check (
    user_id = (select auth.uid())
    and (select public.may_access_own_data())
  );

create index if not exists budget_category_limits_sync_idx
  on public.budget_category_limits (user_id, updated_at);

-- One cap per category per account, enforced rather than assumed. The derived id
-- already implies it, but an id is a client-side convention and this is the
-- constraint that holds when a client gets it wrong.
create unique index if not exists budget_category_limits_pair_idx
  on public.budget_category_limits (user_id, category);

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
    'budget_transactions', 'budget_category_limits', 'savings_goals', 'budget_debts',
    'budget_settings',
    'gallery_albums', 'gallery_photos',
    'songs', 'playlists', 'playlist_songs',
    'private_entries'
  ];
$$;
