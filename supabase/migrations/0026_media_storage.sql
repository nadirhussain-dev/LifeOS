-- 0026 — Media bytes: a private bucket, per-user isolation, and a real quota.
--
-- 0016 made media metadata sync — albums, captions, ordering, favourites — and
-- deliberately left the bytes on the device that imported them, showing as
-- "Not on this device" elsewhere. `remote_path` has existed on all four media
-- tables since then with nothing writing it. This is what writes it.
--
-- ## Why a quota is part of the migration and not a follow-up
--
-- TODO.md's own note: at scale this is the line item that dominates the bill,
-- so it "wants a quota and an opt-in before it wants code". Both are here. The
-- opt-in lives in the app (off by default); the quota lives here, because a
-- limit enforced only by the client is not a limit — it is a suggestion to
-- whoever has not modified the client.
--
-- Supabase's per-bucket `file_size_limit` caps a single object. It says nothing
-- about the total one account can accumulate, which is the number that actually
-- costs money, so that check is a trigger below.
--
-- ## Path layout
--
-- `<uid>/<table>/<row-id><ext>` — the uid first, because every policy here is
-- "the first path segment is your own uid" and a layout that puts anything else
-- first makes that check impossible to write.

-- ---------------------------------------------------------------------------
-- The bucket. Private: there are no public URLs anywhere in this scheme, and a
-- signed URL with a short life is how bytes are ever read.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'media',
  'media',
  false,
  -- 50 MB per object. The gallery already refuses videos over 30 MB on device
  -- (MAX_VIDEO_BYTES), so this is headroom rather than a second opinion.
  52428800,
  array[
    'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/gif',
    'video/mp4', 'video/quicktime',
    'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/wav', 'audio/x-m4a',
    'application/pdf'
  ]
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- Isolation. One rule, four verbs: the first path segment must be your own uid.
-- ---------------------------------------------------------------------------

/**
 * True when `name` is an object path belonging to the calling user.
 *
 * `storage.foldername(name)` splits the path; element 1 is the first segment.
 * Comparing it to `auth.uid()::text` is the whole isolation model — everything
 * else in this file is either the bucket or the quota.
 */
create or replace function public.owns_media_object(name text)
returns boolean
language sql
stable
set search_path = public
as $$
  select (storage.foldername(name))[1] = (select auth.uid())::text;
$$;

drop policy if exists "media_read_own" on storage.objects;
create policy "media_read_own" on storage.objects
  for select using (bucket_id = 'media' and public.owns_media_object(name));

drop policy if exists "media_insert_own" on storage.objects;
create policy "media_insert_own" on storage.objects
  for insert with check (bucket_id = 'media' and public.owns_media_object(name));

drop policy if exists "media_update_own" on storage.objects;
create policy "media_update_own" on storage.objects
  for update using (bucket_id = 'media' and public.owns_media_object(name))
  with check (bucket_id = 'media' and public.owns_media_object(name));

drop policy if exists "media_delete_own" on storage.objects;
create policy "media_delete_own" on storage.objects
  for delete using (bucket_id = 'media' and public.owns_media_object(name));

-- ---------------------------------------------------------------------------
-- The quota.
-- ---------------------------------------------------------------------------

/**
 * Bytes this account currently stores.
 *
 * Read from `storage.objects.metadata->>'size'`, which is what Storage records
 * on upload. Callable by the user, because the app has to show them where they
 * are against the limit — a quota nobody can see is a quota that only ever
 * appears as an unexplained failure.
 */
create or replace function public.media_bytes_used()
returns bigint
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(sum((o.metadata->>'size')::bigint), 0)
    from storage.objects o
   where o.bucket_id = 'media'
     and (storage.foldername(o.name))[1] = (select auth.uid())::text;
$$;

/**
 * The per-account ceiling, in bytes.
 *
 * A function rather than a literal so it can be raised for everyone in one
 * statement, and so the app and the trigger cannot disagree about the number.
 *
 * ⚠️ 2 GB is a placeholder chosen to be obviously finite, not a costed
 * decision. Set it from what you are willing to pay per account before opening
 * this to anyone: at a million accounts the difference between 2 GB and 20 GB
 * is the difference between a hobby bill and a funding round.
 */
create or replace function public.media_quota_bytes()
returns bigint
language sql
immutable
as $$
  select 2147483648::bigint;  -- 2 GiB
$$;

/**
 * Refuses an upload that would put the account over its quota.
 *
 * A BEFORE INSERT trigger rather than a policy, because a policy can only say
 * yes or no to *this row* and the question here is about the sum of all of
 * them. Enforced on the server for the obvious reason: the client's own check
 * exists to give a good error message, not to be the limit.
 */
create or replace function public.enforce_media_quota()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid text := (storage.foldername(new.name))[1];
  v_used bigint;
  v_incoming bigint := coalesce((new.metadata->>'size')::bigint, 0);
begin
  if new.bucket_id <> 'media' then
    return new;
  end if;

  select coalesce(sum((o.metadata->>'size')::bigint), 0)
    into v_used
    from storage.objects o
   where o.bucket_id = 'media'
     and (storage.foldername(o.name))[1] = v_uid;

  if v_used + v_incoming > public.media_quota_bytes() then
    raise exception 'media storage quota exceeded'
      using errcode = 'disk_full';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_media_quota_trigger on storage.objects;
create trigger enforce_media_quota_trigger
  before insert on storage.objects
  for each row execute function public.enforce_media_quota();

revoke all on function public.media_bytes_used() from public, anon;
revoke all on function public.media_quota_bytes() from public, anon;
grant execute on function public.media_bytes_used() to authenticated;
grant execute on function public.media_quota_bytes() to authenticated;
