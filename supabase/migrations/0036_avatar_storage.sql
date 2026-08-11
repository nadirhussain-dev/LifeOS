-- 0036 — Avatar storage: the bucket features/profile/services/avatar.ts
-- always assumed existed, but never actually created.
--
-- 0013 added `profiles.avatar_path`/`avatar_updated_at` and avatar.ts has
-- called `supabase.storage.from('avatars').upload(...)` /
-- `getPublicUrl(...)` since then — but no migration ever ran
-- `insert into storage.buckets`, so every upload failed against a bucket
-- that was never there, surfacing to the user as a generic "check your
-- connection and try again" (avatar.ts collapsed every failure into one
-- message; see the accompanying app fix that classifies them properly).
--
-- Public, unlike `media` (0026) and `shared-albums` (0028): a profile
-- picture is the one thing in this app that's supposed to be visible —
-- profile.tsx's own copy says so ("photoVisibility"). getPublicUrl() is a
-- stable URL with no signing/expiry to manage, which is the right shape for
-- something that isn't a secret. Writes still stay owner-scoped.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  -- 5 MB: avatar.ts crops to a square client-side before upload, so this is
  -- headroom, not a real ceiling anyone should ever approach.
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- Isolation for writes. Reads are open to anyone — see the header comment on
-- why this bucket is public in the first place.
-- ---------------------------------------------------------------------------

/**
 * True when `name` is an object path belonging to the calling user.
 * Same shape as `owns_media_object()` (0026): the path is always
 * `<uid>/avatar.jpg` (avatar.ts), so the first segment is the check.
 */
create or replace function public.owns_avatar_object(name text)
returns boolean
language sql
stable
set search_path = public
as $$
  select (storage.foldername(name))[1] = (select auth.uid())::text;
$$;

drop policy if exists "avatar_read_public" on storage.objects;
create policy "avatar_read_public" on storage.objects
  for select using (bucket_id = 'avatars');

drop policy if exists "avatar_insert_own" on storage.objects;
create policy "avatar_insert_own" on storage.objects
  for insert with check (bucket_id = 'avatars' and public.owns_avatar_object(name));

drop policy if exists "avatar_update_own" on storage.objects;
create policy "avatar_update_own" on storage.objects
  for update using (bucket_id = 'avatars' and public.owns_avatar_object(name))
  with check (bucket_id = 'avatars' and public.owns_avatar_object(name));

drop policy if exists "avatar_delete_own" on storage.objects;
create policy "avatar_delete_own" on storage.objects
  for delete using (bucket_id = 'avatars' and public.owns_avatar_object(name));
