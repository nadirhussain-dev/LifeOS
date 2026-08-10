-- 0028 — Shared-album bytes: the first storage bucket in this codebase whose
-- RLS is keyed on group membership rather than a single owner uid.
--
-- 0026 built the `media` bucket's isolation on one predicate: the first path
-- segment is your own uid. That works because a photo you import belongs to
-- exactly one account. A shared album's photos belong to a *membership*, so
-- the first path segment here is the album id, and the predicate has to ask
-- "is the caller a member of this album" instead of "is the caller this uid".
-- `public.my_album_ids()` (0027) is exactly that question, already hoisted to
-- run once per statement rather than once per row — reused verbatim.
--
-- Path layout: `<album_id>/<photo_id><ext>` — see
-- `features/private/services/album-uploader.ts`.
--
-- The bytes uploaded here are always ciphertext: encrypted client-side under
-- the album key (never seen by this database — see 0027's header) before the
-- upload call. That is a client-side discipline this migration cannot
-- enforce; what it CAN enforce is that nobody outside the album's membership
-- can read, overwrite, or delete the object, which is the actual job of RLS
-- regardless of what is inside the object.

-- ---------------------------------------------------------------------------
-- The bucket. Private, and MIME-less: once content is encrypted its original
-- type is meaningless to Storage — the real type is applied client-side,
-- after decrypt, from the row's own metadata (shared_album_photos).
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'shared-albums',
  'shared-albums',
  false,
  52428800,  -- 50 MB/object, same headroom as the `media` bucket (0026).
  array['application/octet-stream']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- Isolation. Same shape as owns_media_object (0026), different predicate.
-- ---------------------------------------------------------------------------

create or replace function public.owns_shared_album_object(name text)
returns boolean
language sql
stable
set search_path = public
as $$
  select (storage.foldername(name))[1] in (select public.my_album_ids());
$$;

drop policy if exists "shared_album_objects_select" on storage.objects;
create policy "shared_album_objects_select" on storage.objects
  for select using (bucket_id = 'shared-albums' and public.owns_shared_album_object(name));

drop policy if exists "shared_album_objects_insert" on storage.objects;
create policy "shared_album_objects_insert" on storage.objects
  for insert with check (bucket_id = 'shared-albums' and public.owns_shared_album_object(name));

drop policy if exists "shared_album_objects_update" on storage.objects;
create policy "shared_album_objects_update" on storage.objects
  for update using (bucket_id = 'shared-albums' and public.owns_shared_album_object(name))
  with check (bucket_id = 'shared-albums' and public.owns_shared_album_object(name));

drop policy if exists "shared_album_objects_delete" on storage.objects;
create policy "shared_album_objects_delete" on storage.objects
  for delete using (bucket_id = 'shared-albums' and public.owns_shared_album_object(name));

-- ---------------------------------------------------------------------------
-- Quota — billed to the UPLOADER, not the album.
--
-- 0026's enforce_media_quota() derives the billed account from the path's
-- first segment, which works only because in that bucket the first segment
-- IS the uploader's uid. Here the first segment is the album id — a shared
-- album can have several uploaders, and the path alone no longer says who.
--
-- The fix is to stamp the uploader on the object itself, from auth.uid()
-- inside this trigger — never trusted from client-supplied metadata, so
-- quota cannot be attributed to (or evaded via) another account — and sum
-- against that stamp instead of the path.
--
-- Billed against the SAME `media_quota_bytes()` ceiling as the `media`
-- bucket (0026), deliberately, rather than a second number: it is the same
-- kind of cost (an account's photos occupying server storage), and one
-- placeholder to eventually raise is safer than two that can drift apart.
-- ---------------------------------------------------------------------------

create or replace function public.shared_album_bytes_used()
returns bigint
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(sum((o.metadata->>'size')::bigint), 0)
    from storage.objects o
   where o.bucket_id = 'shared-albums'
     and o.metadata->>'uploader_id' = (select auth.uid())::text;
$$;

create or replace function public.enforce_shared_album_quota()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_used bigint;
  v_incoming bigint := coalesce((new.metadata->>'size')::bigint, 0);
begin
  if new.bucket_id <> 'shared-albums' then
    return new;
  end if;

  if v_uid is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;

  new.metadata := coalesce(new.metadata, '{}'::jsonb)
    || jsonb_build_object('uploader_id', v_uid::text);

  select coalesce(sum((o.metadata->>'size')::bigint), 0)
    into v_used
    from storage.objects o
   where o.bucket_id = 'shared-albums'
     and o.metadata->>'uploader_id' = v_uid::text;

  if v_used + v_incoming > public.media_quota_bytes() then
    raise exception 'shared album storage quota exceeded'
      using errcode = 'disk_full';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_shared_album_quota_trigger on storage.objects;
create trigger enforce_shared_album_quota_trigger
  before insert on storage.objects
  for each row execute function public.enforce_shared_album_quota();

revoke all on function public.shared_album_bytes_used() from public, anon;
grant execute on function public.shared_album_bytes_used() to authenticated;
