-- 0032 — Shared albums are the one Plus feature that can't be enforced by
-- a storage quota, because it isn't a storage question: a free account
-- creating unlimited albums or packing a hundred people into one costs
-- nothing in bytes and everything in what "shared, private space" is
-- supposed to mean. This is the server-side half of the free tier's shape —
-- one owned album, two active members — with the client-side check in
-- use-shared-albums.ts existing only to give a good error before the
-- attempt, same relationship every other limit in this codebase has to its
-- trigger.
--
-- Deliberately NOT quota-shaped like media_quota_bytes(): row counts, not
-- bytes, so there is no equivalent "the free Supabase plan can't back this
-- number" risk — see 0030's header for why that risk was real for storage
-- and isn't here.

-- ===========================================================================
-- The two limits, as functions (0026's reasoning: one statement raises them
-- for everyone later, and the app and the trigger can't disagree).
-- ===========================================================================

create or replace function public.free_album_limit()
returns integer
language sql
immutable
as $$
  select 1;
$$;

create or replace function public.free_album_member_limit()
returns integer
language sql
immutable
as $$
  select 2;
$$;

-- The plan that governs one album's capacity is its OWNER's, not whichever
-- member happens to be inviting — "upgrade to grow this space" only makes
-- sense pointed at the person who could actually act on it. STABLE + SECURITY
-- DEFINER, same shape as is_shared_album_owner (0027): a policy/trigger that
-- reads shared_album_members must not recurse into its own policy.
create or replace function public.album_owner_plan_id(aid text)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(p.plan_id, 'free')
    from public.shared_album_members m
    join public.profiles p on p.id = m.user_id
   where m.album_id = aid
     and m.role = 'owner'
     and m.deleted_at is null
   limit 1;
$$;

revoke all on function public.free_album_limit() from public, anon;
revoke all on function public.free_album_member_limit() from public, anon;
revoke all on function public.album_owner_plan_id(text) from public, anon;
grant execute on function public.free_album_limit() to authenticated;
grant execute on function public.free_album_member_limit() to authenticated;
grant execute on function public.album_owner_plan_id(text) to authenticated;

-- ===========================================================================
-- Guards
-- ===========================================================================

-- Fires inside create_shared_album (0027), which is SECURITY INVOKER, so
-- auth.uid() here is still the real caller. Counts PRE-existing owned
-- albums only — this is a BEFORE trigger, the row being inserted isn't in
-- the count yet — so a free account's first album always succeeds and its
-- second is what trips this.
create or replace function public.guard_album_creation_plan_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owned integer;
begin
  if public.my_plan_id() <> 'free' then
    return new;
  end if;

  select count(*) into v_owned
    from public.shared_albums
   where created_by = new.created_by
     and deleted_at is null;

  if v_owned >= public.free_album_limit() then
    raise exception 'the free plan allows one shared album at a time — upgrade to create another'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists shared_albums_plan_limit_guard on public.shared_albums;
create trigger shared_albums_plan_limit_guard
  before insert on public.shared_albums
  for each row execute function public.guard_album_creation_plan_limit();

-- Fires on every new member row — the owner's own bootstrap insert included.
-- That insert is deliberately never special-cased: at that moment the count
-- of *existing* active members is 0 (this is a BEFORE trigger and the owner
-- row itself isn't visible to the count yet), which is already under the
-- limit regardless of what album_owner_plan_id resolves to before the owner
-- row exists to be found. The limit only ever bites a real third member.
create or replace function public.guard_album_member_plan_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_active integer;
begin
  if public.album_owner_plan_id(new.album_id) <> 'free' then
    return new;
  end if;

  select count(*) into v_active
    from public.shared_album_members
   where album_id = new.album_id
     and deleted_at is null;

  if v_active >= public.free_album_member_limit() then
    raise exception 'the free plan allows two people per shared album — upgrade to add more'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists shared_album_members_plan_limit_guard on public.shared_album_members;
create trigger shared_album_members_plan_limit_guard
  before insert on public.shared_album_members
  for each row execute function public.guard_album_member_plan_limit();
