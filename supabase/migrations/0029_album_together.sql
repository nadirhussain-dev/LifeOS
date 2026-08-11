-- 0029 — "Together": comments on shared-album photos, and a chat inside the
-- album itself. Both off by default, and only the album owner may switch
-- either on — the same permission model 0027's header already argued for
-- everything else in this feature (membership decided by Postgres, content
-- decided by the client), applied to two more content types.
--
-- Ciphertext, same discipline as name_ciphertext/caption_ciphertext (0027):
-- `body_ciphertext` on both new tables is opaque to this database. Encrypted
-- client-side under the album key before it ever reaches a query — see
-- features/private/services/album-crypto.ts. This migration only ever
-- decides WHO may read or write a row, never what is in it.
--
-- Realtime, for the first time in this codebase: both tables are added to
-- Supabase's `supabase_realtime` publication so a second device sees a new
-- comment or message the moment RLS would let it read one on refresh anyway
-- — Realtime is not a second access-control layer, it rides on the same
-- policies below. Guarded to no-op where the publication doesn't exist (the
-- SQL test harness has no Realtime setup at all), and to no-op on a rerun.

-- ===========================================================================
-- 1. TABLES
-- ===========================================================================

alter table public.shared_albums
  add column if not exists allow_comments boolean not null default false,
  add column if not exists allow_chat boolean not null default false;

create table if not exists public.shared_album_comments (
  id text primary key,
  album_id text not null references public.shared_albums(id) on delete cascade,
  photo_id text references public.shared_album_photos(id) on delete set null,
  author_id uuid references auth.users(id) on delete set null,
  author_name text,
  body_ciphertext text not null,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint
);

create table if not exists public.shared_album_messages (
  id text primary key,
  album_id text not null references public.shared_albums(id) on delete cascade,
  author_id uuid references auth.users(id) on delete set null,
  author_name text,
  body_ciphertext text not null,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint
);

-- ===========================================================================
-- 2. INDEXES
-- ===========================================================================

create index if not exists shared_album_comments_photo_idx
  on public.shared_album_comments (photo_id, created_at);
create index if not exists shared_album_comments_album_idx
  on public.shared_album_comments (album_id, created_at);
create index if not exists shared_album_messages_album_idx
  on public.shared_album_messages (album_id, created_at);

-- ===========================================================================
-- 3. HELPERS — whether an album currently allows the write being attempted.
-- STABLE + SECURITY DEFINER, same shape as is_shared_album_owner (0027), so a
-- policy that reads shared_albums does not recurse into its own policy.
-- Defaults closed: a row that somehow has neither column set (should not
-- happen, the columns are NOT NULL) reads as "not allowed" rather than open.
-- ===========================================================================

create or replace function public.album_allows_comments(aid text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    (select a.allow_comments from public.shared_albums a where a.id = aid),
    false
  );
$$;

create or replace function public.album_allows_chat(aid text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    (select a.allow_chat from public.shared_albums a where a.id = aid),
    false
  );
$$;

revoke all on function public.album_allows_comments(text) from public, anon;
revoke all on function public.album_allows_chat(text) from public, anon;
grant execute on function public.album_allows_comments(text) to authenticated;
grant execute on function public.album_allows_chat(text) to authenticated;

-- ===========================================================================
-- 4. ROW LEVEL SECURITY
-- ===========================================================================

alter table public.shared_album_comments enable row level security;
alter table public.shared_album_messages enable row level security;

-- --- comments ---
-- Read: any current member, regardless of the allow_comments flag — turning
-- comments off stops new ones, it does not retroactively hide a thread
-- someone already read. Same reasoning shapes the delete policy below.
create policy "shared_album_comments_read" on public.shared_album_comments
  for select using (album_id in (select public.my_album_ids()));

create policy "shared_album_comments_insert" on public.shared_album_comments
  for insert with check (
    album_id in (select public.my_album_ids())
    and public.album_allows_comments(album_id)
    and author_id = (select auth.uid())
  );

-- Soft-delete (or edit) your own comment, or the album owner moderating
-- anyone's — same pair of hands that may already delete a photo
-- (app/private/albums/[id].tsx: `isOwner || selected.addedBy === userId`).
create policy "shared_album_comments_update" on public.shared_album_comments
  for update
  using (
    album_id in (select public.my_album_ids())
    and (author_id = (select auth.uid()) or public.is_shared_album_owner(album_id))
  )
  with check (
    album_id in (select public.my_album_ids())
    and (author_id = (select auth.uid()) or public.is_shared_album_owner(album_id))
  );

-- --- messages --- identical shape, gated by allow_chat instead.
create policy "shared_album_messages_read" on public.shared_album_messages
  for select using (album_id in (select public.my_album_ids()));

create policy "shared_album_messages_insert" on public.shared_album_messages
  for insert with check (
    album_id in (select public.my_album_ids())
    and public.album_allows_chat(album_id)
    and author_id = (select auth.uid())
  );

create policy "shared_album_messages_update" on public.shared_album_messages
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
-- 5. PERMISSION-FLAG GUARD — only the owner may flip allow_comments/
-- allow_chat. shared_albums_update (0027) stays permissive so any member can
-- still rename the album; this narrows the two new columns the same way
-- guard_shared_album_deletion (0027) narrows deleted_at.
-- ===========================================================================

create or replace function public.guard_album_permission_flags()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.allow_comments is distinct from old.allow_comments
      or new.allow_chat is distinct from old.allow_chat)
     and not public.is_shared_album_owner(new.id) then
    raise exception 'only the album owner can change who may comment or chat here'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists shared_album_permission_flags_guard on public.shared_albums;
create trigger shared_album_permission_flags_guard
  before update on public.shared_albums
  for each row execute function public.guard_album_permission_flags();

-- ===========================================================================
-- 6. REALTIME — first use in this repo. No-ops where the publication doesn't
-- exist (the SQL test harness) and where the table is already added (rerun).
-- ===========================================================================

do $$
begin
  if exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public'
         and tablename = 'shared_album_comments'
    ) then
      alter publication supabase_realtime add table public.shared_album_comments;
    end if;

    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public'
         and tablename = 'shared_album_messages'
    ) then
      alter publication supabase_realtime add table public.shared_album_messages;
    end if;
  end if;
end;
$$;
