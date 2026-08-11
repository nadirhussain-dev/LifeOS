-- 0040 — Shared Notes: a freeform thoughts feed for the two of you, distinct
-- from per-photo comments and from the album's own chat. Composer framing
-- (a rotating check-in prompt) lives entirely client-side — see
-- features/private/services/check-in-prompts.ts — this migration only adds
-- somewhere for what gets typed to live.
--
-- Mirrors shared_album_comments (0029) almost exactly, minus photo_id: same
-- ciphertext discipline, same "read regardless of the flag, write gated by
-- it" policy shape. A dedicated table rather than reusing
-- shared_album_comments with photo_id left null (the column already allows
-- it) — on purpose: photo commentary and relationship notes are different
-- enough in intent that a couple may reasonably want them toggled
-- independently, and overloading one allow_comments flag for both would
-- take that choice away.

-- ===========================================================================
-- 1. TABLE + FLAG
-- ===========================================================================

alter table public.shared_albums
  add column if not exists allow_notes boolean not null default false;

create table if not exists public.shared_album_notes (
  id text primary key,
  album_id text not null references public.shared_albums(id) on delete cascade,
  body_ciphertext text not null,
  author_id uuid references auth.users(id) on delete set null,
  author_name text,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint
);

create index if not exists shared_album_notes_album_idx
  on public.shared_album_notes (album_id, created_at);

-- ===========================================================================
-- 2. HELPER — same shape as album_allows_comments/album_allows_chat (0029).
-- ===========================================================================

create or replace function public.album_allows_notes(aid text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    (select a.allow_notes from public.shared_albums a where a.id = aid),
    false
  );
$$;

revoke all on function public.album_allows_notes(text) from public, anon;
grant execute on function public.album_allows_notes(text) to authenticated;

-- ===========================================================================
-- 3. ROW LEVEL SECURITY — same shape as shared_album_comments (0029): read
-- is unconditional (turning notes off does not hide an existing one),
-- insert requires the flag, update/delete is author-or-owner.
-- ===========================================================================

alter table public.shared_album_notes enable row level security;

create policy "shared_album_notes_read" on public.shared_album_notes
  for select using (album_id in (select public.my_album_ids()));

create policy "shared_album_notes_insert" on public.shared_album_notes
  for insert with check (
    album_id in (select public.my_album_ids())
    and public.album_allows_notes(album_id)
    and author_id = (select auth.uid())
  );

create policy "shared_album_notes_update" on public.shared_album_notes
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
-- 4. PERMISSION-FLAG GUARD — extends guard_album_permission_flags() (0029)
-- to also cover allow_notes. Same trigger, no need to redeclare it: the
-- function body is what changes.
-- ===========================================================================

create or replace function public.guard_album_permission_flags()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.allow_comments is distinct from old.allow_comments
      or new.allow_chat is distinct from old.allow_chat
      or new.allow_notes is distinct from old.allow_notes)
     and not public.is_shared_album_owner(new.id) then
    raise exception 'only the album owner can change who may comment, chat, or post notes here'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

-- ===========================================================================
-- 5. REALTIME
-- ===========================================================================

do $$
begin
  if exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public'
         and tablename = 'shared_album_notes'
    ) then
      alter publication supabase_realtime add table public.shared_album_notes;
    end if;
  end if;
end;
$$;
