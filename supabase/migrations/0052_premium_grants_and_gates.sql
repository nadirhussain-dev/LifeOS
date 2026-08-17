-- ---------------------------------------------------------------------------
-- 0052 — Premium: one entitlement, two new gates, and a grant only the owner
--        can make.
--
-- ## 1. Why `has_premium()` rather than another `plan_id = 'free'` test
--
-- Paid access has been asked as `my_plan_id() = 'free'` in each place that
-- cared (0035's media gate, 0037's quota). That worked while a plan was the
-- only way to be paid. It stops working the moment somebody can be *granted*
-- premium without paying — a support gesture, a beta tester, a competition
-- winner — because every one of those call sites would have to learn about
-- grants separately, and the one that was missed would silently refuse a user
-- who had been told they were entitled.
--
-- So entitlement becomes a single function. Both ways of holding it — a plan,
-- or a grant with a deadline — answer through `has_premium()`, and a new gate
-- calls that and nothing else.
--
-- ## 2. Who may grant it
--
-- The owner, and no one else. 0033 already draws the line this needs:
-- `is_owner()` is a singleton (`admins_single_owner_idx`) and additionally
-- requires the caller's device to be on the admin origin allow-list, so an
-- ordinary operator — who can moderate, price plans and read reports — cannot
-- hand out paid access. Granting revenue away is a different kind of power from
-- running the service, and it is the one that wants the narrowest door.
--
-- The window is arbitrary: the caller passes an absolute end instant, so "three
-- days", "until the end of the beta" and "a year" are the same call. Grants are
-- recorded in their own table rather than only stamped on the profile, because
-- "who gave this away, when, and why" is the first question anybody asks about
-- a free upgrade six months later, and a column that only holds the latest end
-- date cannot answer it.
--
-- ## 3. What is now gated
--
-- Profile pictures and shared-album media. Both are a deliberate reversal of
-- 0035's header, which said in as many words that a profile picture "keeps
-- syncing free on every plan, always" and that shared-album photos stay free so
-- the couple use case works. That was a product decision and this is a product
-- decision; what matters technically is that the reversal is stated where the
-- old promise was made, so the next person to read 0035 is not misled by it.
--
-- Both gates refuse at upload. Existing objects are untouched: somebody who
-- already has an avatar keeps it, and an album already holding photos keeps
-- them. A gate that retroactively hid what people had already put there would
-- be a different and much worse feature.
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- 1. THE GRANT
-- ===========================================================================

alter table public.profiles
  add column if not exists premium_until bigint;

comment on column public.profiles.premium_until is
  'Epoch ms this account holds granted premium until. Null = none. Never set '
  'directly — see admin_grant_premium.';

/**
 * The audit trail for free premium.
 *
 * Append-only in practice: a revocation writes a row with `revoked_at` set
 * rather than deleting the grant it ends, so the record of what was given
 * survives the taking back of it.
 */
create table if not exists public.premium_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  granted_by uuid not null references auth.users(id) on delete set null,
  /** Epoch ms. The end of the window; the start is `created_at`. */
  until bigint not null,
  /** Free text, required — a grant with no stated reason is the one nobody can
   *  defend later. */
  reason text not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null
);

create index if not exists premium_grants_user_idx
  on public.premium_grants (user_id, created_at desc);

alter table public.premium_grants enable row level security;

/** Readable by the account it concerns — somebody told they have been given
 *  three months is entitled to see that — and by admins. Writes go through the
 *  functions below, so there is no insert or update policy at all. */
create policy "premium_grants_read_own" on public.premium_grants
  for select using (user_id = (select auth.uid()) or public.is_admin());

-- ===========================================================================
-- 2. THE ENTITLEMENT
-- ===========================================================================

/**
 * Whether the caller may use paid features, however they came by it.
 *
 * STABLE and SECURITY DEFINER, the same shape as `my_plan_id()`, because this
 * is called from storage triggers that run per object.
 *
 * A grant whose `premium_until` has passed simply stops counting — nothing has
 * to run to expire it. That is deliberate: an expiry that depends on a sweep
 * having run is an expiry that silently does not happen the week the sweep is
 * broken.
 */
create or replace function public.has_premium()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
      from public.profiles p
     where p.id = (select auth.uid())
       and (
         p.plan_id <> 'free'
         or (p.premium_until is not null and p.premium_until > (date_part('epoch', now()) * 1000)::bigint)
       )
  );
$$;

revoke all on function public.has_premium() from public, anon;
grant execute on function public.has_premium() to authenticated;

/** The same question about somebody else, for the gates that run against an
 *  album's owner rather than the caller (see `album_owner_plan_id`, 0032). */
create or replace function public.user_has_premium(p_user uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
      from public.profiles p
     where p.id = p_user
       and (
         p.plan_id <> 'free'
         or (p.premium_until is not null and p.premium_until > (date_part('epoch', now()) * 1000)::bigint)
       )
  );
$$;

revoke all on function public.user_has_premium(uuid) from public, anon;
grant execute on function public.user_has_premium(uuid) to authenticated;

-- ===========================================================================
-- 3. GRANTING AND REVOKING — OWNER ONLY
-- ===========================================================================

/**
 * Gives an account premium until `p_until`, free.
 *
 * `is_owner()` rather than `is_operator()`: see the header. The check is inside
 * the function rather than in a policy because the function is SECURITY
 * DEFINER — it writes a row the caller has no direct permission to write, which
 * is the point, and which is exactly why it has to police itself.
 *
 * Extending an existing grant is the same call with a later date; the profile
 * keeps the furthest end, so a second grant can never shorten the first by
 * accident.
 */
create or replace function public.admin_grant_premium(
  p_user_id uuid,
  p_until bigint,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now bigint := (date_part('epoch', now()) * 1000)::bigint;
  v_until bigint;
begin
  if not public.is_owner() then
    raise exception 'only the owner may grant premium' using errcode = 'insufficient_privilege';
  end if;
  if p_user_id is null then
    raise exception 'a user is required' using errcode = 'invalid_parameter_value';
  end if;
  if p_until is null or p_until <= v_now then
    raise exception 'the grant must end in the future' using errcode = 'invalid_parameter_value';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'a reason is required' using errcode = 'invalid_parameter_value';
  end if;

  insert into public.premium_grants (user_id, granted_by, until, reason)
  values (p_user_id, auth.uid(), p_until, trim(p_reason));

  update public.profiles
     set premium_until = greatest(coalesce(premium_until, 0), p_until)
   where id = p_user_id
  returning premium_until into v_until;

  if v_until is null then
    raise exception 'no such account' using errcode = 'no_data_found';
  end if;

  return jsonb_build_object('ok', true, 'premiumUntil', v_until);
end;
$$;

/**
 * Ends a granted window early.
 *
 * Clears `premium_until` outright rather than setting it to now: the two are
 * the same to `has_premium()`, and null is the honest representation of "holds
 * no grant". A paid plan is untouched — this revokes the gift, never the
 * purchase.
 */
create or replace function public.admin_revoke_premium(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_owner() then
    raise exception 'only the owner may revoke premium' using errcode = 'insufficient_privilege';
  end if;

  update public.premium_grants
     set revoked_at = now(), revoked_by = auth.uid()
   where user_id = p_user_id and revoked_at is null;

  update public.profiles set premium_until = null where id = p_user_id;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.admin_grant_premium(uuid, bigint, text) from public, anon;
revoke all on function public.admin_revoke_premium(uuid) from public, anon;
grant execute on function public.admin_grant_premium(uuid, bigint, text) to authenticated;
grant execute on function public.admin_revoke_premium(uuid) to authenticated;

-- ===========================================================================
-- 4. THE GATES
-- ===========================================================================

/**
 * Profile pictures become a paid feature.
 *
 * A trigger rather than a policy edit, matching 0035's media gate, so the
 * refusal carries a message naming the reason instead of surfacing as a bare
 * RLS denial the client has to guess at.
 *
 * Update is included as well as insert: replacing an avatar is uploading one.
 * Delete is not — removing a picture must stay possible for everybody, or a
 * lapsed subscriber cannot take down their own photograph.
 */
create or replace function public.enforce_avatar_premium()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.bucket_id <> 'avatars' then
    return new;
  end if;
  if not public.has_premium() then
    raise exception 'a profile picture requires a paid plan'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_avatar_premium_trigger on storage.objects;
create trigger enforce_avatar_premium_trigger
  before insert or update on storage.objects
  for each row execute function public.enforce_avatar_premium();

/**
 * Shared-album media becomes a paid feature too — reversing 0035's deliberate
 * exemption, which is spelled out in this file's header.
 *
 * Checked against the UPLOADER, not the album's owner. The alternative reading
 * — that one paying member makes the album's storage free for everybody in it —
 * turns a two-person album into a way for one subscription to serve any number
 * of people, and does it invisibly, since nobody in the album can see whose
 * plan is paying.
 */
create or replace function public.enforce_album_media_premium()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.bucket_id <> 'shared-albums' then
    return new;
  end if;
  if not public.has_premium() then
    raise exception 'adding photos to a shared album requires a paid plan'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_album_media_premium_trigger on storage.objects;
create trigger enforce_album_media_premium_trigger
  before insert or update on storage.objects
  for each row execute function public.enforce_album_media_premium();
