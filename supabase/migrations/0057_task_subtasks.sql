-- ---------------------------------------------------------------------------
-- 0057 — A task's checklist.
--
-- The device gained `task_subtasks`: title, done flag, ordering, one row per
-- checklist item, owned by a task. This is the server half, and it is the
-- first synced table added since 0016 — so it is also the first that has to
-- satisfy, up front, every contract those later migrations established for
-- tables that already existed.
--
-- ## Why a table and not `tasks.parent_task_id`
--
-- Recorded here because the schema is where somebody will later wonder. A
-- self-reference would make every existing reader of `tasks` — the dashboard,
-- both widgets, search, the digest, challenge tracking — count checklist items
-- as tasks unless each one remembers to filter, and the symptom is a number
-- that is quietly wrong rather than an error anybody sees.
--
-- ## The four contracts this table is born with
--
-- 1. **The deletion cascade (0020).** `user_id` references `auth.users` with
--    `on delete cascade` in the CREATE, rather than being retrofitted. 0020 had
--    to sweep orphans before it could add the constraint to 36 existing tables;
--    a new table has no orphans yet, and adding the reference now is what stops
--    it from ever being on that list.
--
-- 2. **The current policy shape (0017 + 0019).** `(select auth.uid())`, not
--    `auth.uid()` — an InitPlan computed once per statement that the index can
--    be used against, rather than a re-evaluation per row. And
--    `may_access_own_data()` on both sides, so a blocked account is refused
--    reads as well as writes. Copying 0001's `for all using (user_id =
--    auth.uid())` would have compiled, passed a casual read, and silently
--    reintroduced both problems on this one table.
--
-- 3. **The sync index (0016).** `(user_id, updated_at)`, because every pull is
--    `where user_id = ? and updated_at > ?` and without it that is a
--    sequential scan of everyone's checklist items.
--
-- 4. **The operator whitelist (0019).** `operator_readable_tables()` is
--    re-declared below with `task_subtasks` in it. It is a whitelist guarding a
--    dynamic query, so a table missing from it is not readable by an admin
--    handling an abuse report — the moderation surface would show a task with
--    its checklist silently absent, which reads as "there is nothing here"
--    rather than "this tool cannot see it".
--
-- No `sync_status` or `server_updated_at`: 0016 dropped those from the child
-- tables server-side, because they are the device's own bookkeeping and a
-- second device's copy of them means nothing.
-- ---------------------------------------------------------------------------

create table if not exists public.task_subtasks (
  id text primary key,
  task_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  is_done bigint not null default 0,
  completed_at bigint,
  position bigint not null default 0,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint
);

alter table public.task_subtasks enable row level security;

drop policy if exists "task_subtasks_own" on public.task_subtasks;
create policy "task_subtasks_own" on public.task_subtasks
  for all
  using (
    user_id = (select auth.uid())
    and (select public.may_access_own_data())
  )
  with check (
    user_id = (select auth.uid())
    and (select public.may_access_own_data())
  );

create index if not exists task_subtasks_sync_idx
  on public.task_subtasks (user_id, updated_at);

-- Looking up one task's checklist, which is the only other way this table is
-- ever read.
create index if not exists task_subtasks_task_idx
  on public.task_subtasks (task_id, position);

-- --- the operator whitelist, extended ---------------------------------------

create or replace function public.operator_readable_tables()
returns text[]
language sql
immutable
as $$
  select array[
    'task_categories', 'tasks', 'task_subtasks',
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
    'budget_transactions', 'savings_goals', 'budget_debts', 'budget_settings',
    'gallery_albums', 'gallery_photos',
    'songs', 'playlists', 'playlist_songs',
    'private_entries'
  ];
$$;
