-- ---------------------------------------------------------------------------
-- 0058 — Tags on tasks, drawn from the tag list that already exists.
--
-- ## The vocabulary is shared, not copied
--
-- There is no `task_tags` table here, and that is the decision worth recording.
-- Tags live in `note_tags`, whose name became a misnomer the moment anything
-- other than a note could carry one. The alternative — a second, parallel tag
-- list owned by tasks — would look correct on either screen in isolation and
-- be wrong across the app: `#renovation` on a note and `#renovation` on a task
-- would be two different rows, search would return one of them, and merging
-- them later would mean reconciling two vocabularies that had drifted for
-- however long it took someone to notice.
--
-- Sharing them is also the thing this app is for. A task, a note and
-- eventually a transaction under one tag is a join no collection of
-- single-purpose apps can offer, because their tags live in different
-- companies' databases.
--
-- ## Why `note_tags` is not renamed to `tags`
--
-- It should be, and it is not, deliberately. Renaming a synced table renames it
-- on the server and on every device, and sync cursors are per table — so every
-- install would re-pull every tag to correct a word. The name is wrong; the
-- cost of fixing it is a migration whose only benefit is the name. Left as a
-- known misnomer with this comment as the record.
--
-- ## Shape
--
-- Mirrors `note_tag_links` exactly, including the derived id (`taskId:tagId`)
-- that 0016 gave the join tables: two devices that add the same tag offline
-- produce the same row and the upsert collapses them, rather than tagging the
-- task twice and leaving a duplicate no screen can distinguish.
--
-- Same four contracts as 0057 — cascade in the CREATE, the 0017/0019 policy
-- shape, the `(user_id, updated_at)` sync index, and a place on the operator
-- whitelist. No foreign key to `tasks` or `note_tags`: rows arrive from the
-- sync engine in table order, and a link whose task or tag has not been pushed
-- yet must be storable rather than rejected. The unique constraint on the pair
-- is what actually protects the data here.
-- ---------------------------------------------------------------------------

create table if not exists public.task_tag_links (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id text not null,
  tag_id text not null,
  updated_at bigint not null,
  deleted_at bigint
);

alter table public.task_tag_links enable row level security;

drop policy if exists "task_tag_links_own" on public.task_tag_links;
create policy "task_tag_links_own" on public.task_tag_links
  for all
  using (
    user_id = (select auth.uid())
    and (select public.may_access_own_data())
  )
  with check (
    user_id = (select auth.uid())
    and (select public.may_access_own_data())
  );

create index if not exists task_tag_links_sync_idx
  on public.task_tag_links (user_id, updated_at);

create unique index if not exists task_tag_links_pair_idx
  on public.task_tag_links (task_id, tag_id);

-- "Everything tagged X", which is the query the shared vocabulary exists for.
create index if not exists task_tag_links_tag_idx
  on public.task_tag_links (tag_id);

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
    'budget_transactions', 'savings_goals', 'budget_debts', 'budget_settings',
    'gallery_albums', 'gallery_photos',
    'songs', 'playlists', 'playlist_songs',
    'private_entries'
  ];
$$;
