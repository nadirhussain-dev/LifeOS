-- 0038 — Shared Plans: a date-sorted list of things a couple mean to do,
-- living in the same album as their photos.
--
-- Same ciphertext discipline as everything else in this feature (0027/0029):
-- `title_ciphertext`/`notes_ciphertext` are opaque to this database, sealed
-- client-side under the album key before they ever reach a query — see
-- features/private/services/album-crypto.ts.
--
-- `event_date` is deliberately PLAINTEXT, unlike the title/notes. A date
-- alone, without what it's for, is not the sensitive half of "we're doing
-- something on the 14th" — and it needs to be cheaply sortable server-side,
-- the same reasoning that already keeps shared_album_photos.created_at and
-- every other timestamp in this schema plaintext.
--
-- No allow_plans flag, unlike comments/chat (0029). A shared plan list is
-- core, structural content — the same category as the photo grid itself,
-- which has no allow_photos flag either — not something conversational one
-- partner might want switched off. Any member may read, add, or edit their
-- own; the album owner may edit/remove any (same shape as comments).

-- ===========================================================================
-- 1. TABLE
-- ===========================================================================

create table if not exists public.shared_album_events (
  id text primary key,
  album_id text not null references public.shared_albums(id) on delete cascade,
  title_ciphertext text not null,
  notes_ciphertext text,
  -- yyyy-MM-dd, plaintext — see header.
  event_date text not null,
  author_id uuid references auth.users(id) on delete set null,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint
);

create index if not exists shared_album_events_album_idx
  on public.shared_album_events (album_id, event_date);

-- ===========================================================================
-- 2. ROW LEVEL SECURITY — same shape as shared_album_comments (0029), minus
-- the allow_* gate.
-- ===========================================================================

alter table public.shared_album_events enable row level security;

create policy "shared_album_events_read" on public.shared_album_events
  for select using (album_id in (select public.my_album_ids()));

create policy "shared_album_events_insert" on public.shared_album_events
  for insert with check (
    album_id in (select public.my_album_ids())
    and author_id = (select auth.uid())
  );

create policy "shared_album_events_update" on public.shared_album_events
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
-- 3. REALTIME — same guarded, rerun-safe block as 0029.
-- ===========================================================================

do $$
begin
  if exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public'
         and tablename = 'shared_album_events'
    ) then
      alter publication supabase_realtime add table public.shared_album_events;
    end if;
  end if;
end;
$$;
