-- 0039 — Custom milestones: user-defined dated anniversaries alongside the
-- existing day-count ones (TOGETHER_MILESTONES,
-- features/private/services/together.ts), which only ever count days since
-- the album itself was created. "Our anniversary", "first kiss", "moved in
-- together" are dates a couple names themselves, optionally recurring
-- yearly.
--
-- Same shape as 0038's shared_album_events in every respect that matters:
-- title_ciphertext opaque, milestone_date plaintext (needs to be compared
-- against "today" cheaply, same reasoning as event_date), no allow_* flag —
-- this is the smallest of the three "Us" additions and stays unconditional,
-- like TOGETHER_MILESTONES already is.

-- ===========================================================================
-- 1. TABLE
-- ===========================================================================

create table if not exists public.shared_album_milestones (
  id text primary key,
  album_id text not null references public.shared_albums(id) on delete cascade,
  title_ciphertext text not null,
  -- yyyy-MM-dd, plaintext — see 0038's header for why the date half of this
  -- content stays out of the ciphertext.
  milestone_date text not null,
  -- Yearly, on the same month/day, once true — see together.ts's
  -- nextMilestone() for the rollover math.
  recurring boolean not null default false,
  author_id uuid references auth.users(id) on delete set null,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint
);

create index if not exists shared_album_milestones_album_idx
  on public.shared_album_milestones (album_id, milestone_date);

-- ===========================================================================
-- 2. ROW LEVEL SECURITY — identical shape to 0038's shared_album_events.
-- ===========================================================================

alter table public.shared_album_milestones enable row level security;

create policy "shared_album_milestones_read" on public.shared_album_milestones
  for select using (album_id in (select public.my_album_ids()));

create policy "shared_album_milestones_insert" on public.shared_album_milestones
  for insert with check (
    album_id in (select public.my_album_ids())
    and author_id = (select auth.uid())
  );

create policy "shared_album_milestones_update" on public.shared_album_milestones
  for update
  using (
    album_id in (select public.my_album_ids())
    and (author_id = (select auth.uid()) or public.is_shared_album_owner(album_id))
  )
  with check (
    album_id in (select public.my_album_ids())
    and (author_id = (select auth.uid()) or public.is_shared_album_owner(album_id))
  );

-- ===========================================================================
-- 3. REALTIME
-- ===========================================================================

do $$
begin
  if exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public'
         and tablename = 'shared_album_milestones'
    ) then
      alter publication supabase_realtime add table public.shared_album_milestones;
    end if;
  end if;
end;
$$;
