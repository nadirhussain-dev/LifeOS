-- ---------------------------------------------------------------------------
-- 0059 — Three tiers, and one place that says what a tier includes.
--
-- ## 1. Why this exists
--
-- `billing_plans` (0034) carries exactly one capability column,
-- `storage_bytes`. Everything else that varies by plan is hardcoded somewhere
-- else: `free_album_limit()` (0032) returns a literal 1,
-- `free_album_member_limit()` a literal 2, `has_premium()` (0052) returns a
-- boolean, and the client asks `planId !== 'free'`. Four mechanisms for one
-- concept.
--
-- That worked while "paid" was a single thing. It cannot express a third tier
-- at all: "Standard gets 5 albums, Premium gets unlimited" is unsayable in
-- this schema, because there is no column to say it in and no row to say it
-- about.
--
-- So entitlement becomes data. `plan_entitlements` holds one row per
-- (tier, key), every gate reads it through one function, and adding a
-- capability is an insert rather than a migration plus a release.
--
-- ## 2. Why entitlements hang off a tier, not a plan id
--
-- `standard_monthly` and `standard_yearly` are two rows for one product —
-- 0034 seeded `plus_monthly`/`plus_yearly` exactly that way, and its own
-- header notes the yearly plan's offer "is the price, not more space". If
-- entitlements hung off the plan row, the whole matrix would be duplicated
-- per billing period and would drift the first time somebody edited one and
-- not the other. Tier is the thing a capability actually belongs to.
--
-- ## 3. This migration changes no behaviour
--
-- Deliberately. It adds the model, seeds it, and redefines `has_premium()` in
-- terms of it *without changing what that function answers* — see section 5.
-- The ten existing gates still read their old literals. Converting them is one
-- commit each, so a regression is attributable to one gate rather than to
-- "the tier migration".
--
-- The new Standard/Premium plan rows are seeded `active = false` for the same
-- reason: they are unpriced (prices move to `plan_prices` in 0060, and the
-- numbers are not decided yet). An inactive plan is invisible to the picker —
-- 0034's `billing_plans_read` policy is `active or is_admin()` — so seeding
-- them cannot show anyone a price that was never agreed. Activate through
-- `admin_set_plan_active` once priced; no release needed.
--
-- ## 4. Legacy Plus maps to Standard
--
-- Decided. `plus_monthly`/`plus_yearly` backfill to tier `standard` and stay
-- exactly as valid as they were — `profiles.plan_id` is a foreign key into
-- this table and existing subscribers point at those ids, so they are archived
-- rather than renamed, per 0034's "archive, never erase".
--
-- One thing to notice before converting gates later: the seeded matrix gives
-- `voice_notes` to Premium only, while `enforce_album_media_premium` (0054)
-- currently allows it for anyone paid. Converting that gate is therefore a
-- takeaway from existing Standard subscribers, not a no-op. That is a product
-- decision to make deliberately at conversion time; this migration does not
-- make it.
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- 1. TIER ON A PLAN
-- ===========================================================================

alter table public.billing_plans
  add column if not exists tier text not null default 'freemium';

-- Backfill before constraining: every existing row is either the free plan or
-- a Plus row, and Plus is Standard now (section 4).
update public.billing_plans
   set tier = case when period = 'free' then 'freemium' else 'standard' end;

alter table public.billing_plans
  drop constraint if exists billing_plans_tier_check;
alter table public.billing_plans
  add constraint billing_plans_tier_check
  check (tier in ('freemium', 'standard', 'premium'));

comment on column public.billing_plans.tier is
  'Which entitlement set this plan grants. Several plan rows (monthly, yearly) '
  'share one tier on purpose — see plan_entitlements.';

-- ===========================================================================
-- 2. THE ENTITLEMENTS
-- ===========================================================================

create table if not exists public.plan_entitlements (
  tier text not null check (tier in ('freemium', 'standard', 'premium')),
  key text not null,
  -- jsonb because the ten gates this replaces are a mix of booleans and
  -- numbers, and the eleventh will be neither.
  value jsonb not null,
  updated_at bigint not null,
  primary key (tier, key)
);

alter table public.plan_entitlements enable row level security;

-- Reference data: every signed-in account needs the whole matrix to render a
-- plan comparison. Not granted to anon — a signed-out client has no tier to
-- resolve and falls back to the freemium defaults it ships with.
create policy "plan_entitlements_read" on public.plan_entitlements
  for select to authenticated using (true);

-- No write policy, on purpose — same discipline as billing_plans (0034):
-- mutations go through an audited RPC, never a raw client update.

-- ===========================================================================
-- 3. THE SEED
--
-- Mirrored by ENTITLEMENT_DEFAULTS (features/billing/config/entitlements.ts),
-- which is the client's offline fallback. The fallback is the *freemium* row
-- specifically: a network failure must never hand out a paid capability.
--
-- `-1` means unlimited rather than null, because a missing key has to mean
-- "not configured, deny", and null and absent are too easy to confuse in the
-- comparison that decides whether somebody may upload.
-- ===========================================================================

insert into public.plan_entitlements (tier, key, value, updated_at)
values
  -- storage_bytes duplicates billing_plans.storage_bytes for now; 0060 makes
  -- this the only copy once media_quota_bytes() is converted.
  ('freemium', 'storage_bytes',      to_jsonb(52428800::bigint),    (extract(epoch from now()) * 1000)::bigint),
  ('freemium', 'media_backup',       to_jsonb(false),               (extract(epoch from now()) * 1000)::bigint),
  ('freemium', 'album_limit',        to_jsonb(1),                   (extract(epoch from now()) * 1000)::bigint),
  ('freemium', 'album_member_limit', to_jsonb(2),                   (extract(epoch from now()) * 1000)::bigint),
  ('freemium', 'avatar_upload',      to_jsonb(false),               (extract(epoch from now()) * 1000)::bigint),
  ('freemium', 'album_media_upload', to_jsonb(false),               (extract(epoch from now()) * 1000)::bigint),
  ('freemium', 'voice_notes',        to_jsonb(false),               (extract(epoch from now()) * 1000)::bigint),
  ('freemium', 'ads',                to_jsonb(true),                (extract(epoch from now()) * 1000)::bigint),
  ('freemium', 'insights',           to_jsonb(false),               (extract(epoch from now()) * 1000)::bigint),
  ('freemium', 'on_this_day_years',  to_jsonb(1),                   (extract(epoch from now()) * 1000)::bigint),

  ('standard', 'storage_bytes',      to_jsonb(16106127360::bigint), (extract(epoch from now()) * 1000)::bigint),
  ('standard', 'media_backup',       to_jsonb(true),                (extract(epoch from now()) * 1000)::bigint),
  ('standard', 'album_limit',        to_jsonb(5),                   (extract(epoch from now()) * 1000)::bigint),
  ('standard', 'album_member_limit', to_jsonb(10),                  (extract(epoch from now()) * 1000)::bigint),
  ('standard', 'avatar_upload',      to_jsonb(true),                (extract(epoch from now()) * 1000)::bigint),
  ('standard', 'album_media_upload', to_jsonb(true),                (extract(epoch from now()) * 1000)::bigint),
  ('standard', 'voice_notes',        to_jsonb(false),               (extract(epoch from now()) * 1000)::bigint),
  ('standard', 'ads',                to_jsonb(false),               (extract(epoch from now()) * 1000)::bigint),
  ('standard', 'insights',           to_jsonb(true),                (extract(epoch from now()) * 1000)::bigint),
  ('standard', 'on_this_day_years',  to_jsonb(5),                   (extract(epoch from now()) * 1000)::bigint),

  ('premium',  'storage_bytes',      to_jsonb(107374182400::bigint),(extract(epoch from now()) * 1000)::bigint),
  ('premium',  'media_backup',       to_jsonb(true),                (extract(epoch from now()) * 1000)::bigint),
  ('premium',  'album_limit',        to_jsonb(-1),                  (extract(epoch from now()) * 1000)::bigint),
  ('premium',  'album_member_limit', to_jsonb(-1),                  (extract(epoch from now()) * 1000)::bigint),
  ('premium',  'avatar_upload',      to_jsonb(true),                (extract(epoch from now()) * 1000)::bigint),
  ('premium',  'album_media_upload', to_jsonb(true),                (extract(epoch from now()) * 1000)::bigint),
  ('premium',  'voice_notes',        to_jsonb(true),                (extract(epoch from now()) * 1000)::bigint),
  ('premium',  'ads',                to_jsonb(false),               (extract(epoch from now()) * 1000)::bigint),
  ('premium',  'insights',           to_jsonb(true),                (extract(epoch from now()) * 1000)::bigint),
  ('premium',  'on_this_day_years',  to_jsonb(15),                  (extract(epoch from now()) * 1000)::bigint)
on conflict (tier, key) do nothing;

-- Every tier must define every key. A missing cell resolves to null, and a
-- null entitlement denies — so the failure mode of a typo in the seed above is
-- a paying customer silently refused a feature they bought. Fail the deploy
-- instead.
do $$
declare
  v_missing text;
begin
  select string_agg(t.tier || '.' || k.key, ', ')
    into v_missing
    from (select unnest(array['freemium', 'standard', 'premium']) as tier) t
   cross join (select distinct key from public.plan_entitlements) k
    where not exists (
      select 1 from public.plan_entitlements e
       where e.tier = t.tier and e.key = k.key
    );

  if v_missing is not null then
    raise exception 'plan_entitlements is missing cells: %', v_missing;
  end if;
end;
$$;

-- ===========================================================================
-- 4. THE PLAN ROWS
--
-- There is no new freemium *row*. The `free` row seeded by 0034 already is the
-- freemium plan — it backfilled to tier `freemium` in section 1 — so adding a
-- second free-period row would put two identical free plans in front of every
-- user and leave `profiles.plan_id` with two values meaning the same thing.
-- Only its display name changes, and only because "Freemium" is the name the
-- three tiers are being launched under. The id stays `free`: it is a foreign
-- key target that live rows point at.
--
-- The four paid rows are inactive until priced — see the header, section 3.
-- `storage_bytes` mirrors the matrix above so 0037's media_quota_bytes() stays
-- consistent for whoever lands on one before the gate conversion.
-- ===========================================================================

update public.billing_plans
   set name = 'Freemium',
       updated_at = (extract(epoch from now()) * 1000)::bigint
 where id = 'free';

insert into public.billing_plans
  (id, name, tier, storage_bytes, price_cents, currency, period, badge, sort_order, active, created_at, updated_at)
values
  ('standard_monthly', 'Standard', 'standard', 16106127360, 0, 'usd', 'month', null, 1, false,
    (extract(epoch from now()) * 1000)::bigint, (extract(epoch from now()) * 1000)::bigint),
  ('standard_yearly', 'Standard', 'standard', 16106127360, 0, 'usd', 'year', 'best_value', 2, false,
    (extract(epoch from now()) * 1000)::bigint, (extract(epoch from now()) * 1000)::bigint),
  ('premium_monthly', 'Premium', 'premium', 107374182400, 0, 'usd', 'month', null, 3, false,
    (extract(epoch from now()) * 1000)::bigint, (extract(epoch from now()) * 1000)::bigint),
  ('premium_yearly', 'Premium', 'premium', 107374182400, 0, 'usd', 'year', 'best_value', 4, false,
    (extract(epoch from now()) * 1000)::bigint, (extract(epoch from now()) * 1000)::bigint)
on conflict (id) do nothing;

-- ===========================================================================
-- 5. RESOLVING A TIER
-- ===========================================================================

create or replace function public.tier_rank(p_tier text)
returns integer
language sql
immutable
as $$
  select case p_tier
    when 'premium' then 3
    when 'standard' then 2
    when 'freemium' then 1
    else 0
  end;
$$;

comment on function public.tier_rank(text) is
  'Orders tiers so entitlement can be compared. 0 for anything unrecognised, '
  'so an unknown tier is the weakest rather than accidentally the strongest.';

-- A grant now names which tier it gives, rather than handing out a boolean.
alter table public.premium_grants
  add column if not exists tier text not null default 'premium';
alter table public.premium_grants
  drop constraint if exists premium_grants_tier_check;
alter table public.premium_grants
  add constraint premium_grants_tier_check
  check (tier in ('freemium', 'standard', 'premium'));

alter table public.profiles
  add column if not exists granted_tier text;
alter table public.profiles
  drop constraint if exists profiles_granted_tier_check;
alter table public.profiles
  add constraint profiles_granted_tier_check
  check (granted_tier is null or granted_tier in ('freemium', 'standard', 'premium'));

comment on column public.profiles.granted_tier is
  'Tier of the live grant, paired with premium_until. Null with a premium_until '
  'set reads as premium — that is what a pre-0057 grant meant. Never set '
  'directly; see admin_grant_premium.';

-- Any grant issued before this migration was a premium grant by definition.
update public.profiles
   set granted_tier = 'premium'
 where premium_until is not null and granted_tier is null;

/**
 * The tier an account actually holds: the stronger of what they pay for and
 * what they were given.
 *
 * A maximum, not an override, and that is the whole point. A Standard
 * subscriber granted Premium for a month drops back to *Standard* when the
 * grant lapses, not to Freemium — an override would silently cancel the plan
 * they are still paying for.
 *
 * An expired grant simply stops counting, with nothing to run to expire it —
 * same reasoning `has_premium()` (0052) gives: an expiry that depends on a
 * sweep having run is an expiry that does not happen the week the sweep is
 * broken.
 *
 * STABLE + SECURITY DEFINER, the shape every per-caller helper here uses
 * (my_plan_id, has_premium, my_album_ids), because this is called from storage
 * triggers that run per object.
 */
create or replace function public.user_tier(p_user uuid)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    (
      select case
               when public.tier_rank(t.plan_tier) >= public.tier_rank(t.grant_tier)
               then t.plan_tier
               else t.grant_tier
             end
        from (
          select
            coalesce(bp.tier, 'freemium') as plan_tier,
            case
              when p.premium_until is not null
               and p.premium_until > (date_part('epoch', now()) * 1000)::bigint
              then coalesce(p.granted_tier, 'premium')
              else 'freemium'
            end as grant_tier
          from public.profiles p
          left join public.billing_plans bp on bp.id = p.plan_id
         where p.id = p_user
        ) t
    ),
    'freemium'
  );
$$;

revoke all on function public.user_tier(uuid) from public, anon;
grant execute on function public.user_tier(uuid) to authenticated;

create or replace function public.my_tier()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select public.user_tier((select auth.uid()));
$$;

revoke all on function public.my_tier() from public, anon;
grant execute on function public.my_tier() to authenticated;

/**
 * `has_premium()` (0052), re-expressed — and deliberately NOT narrowed to
 * `my_tier() = 'premium'`.
 *
 * Today it answers "does this account hold paid access", and three triggers
 * (avatar upload 0052, album media 0052, voice notes 0054) gate on it. A
 * Plus subscriber backfills to Standard, so narrowing this to Premium here
 * would strip all three from every existing paying customer the moment this
 * migration ran. Same question, same answer, now derived from the tier
 * ladder — the individual gates move onto their own entitlement keys one
 * commit at a time, where the change is visible and reviewable.
 */
create or replace function public.has_premium()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.tier_rank(public.my_tier()) >= public.tier_rank('standard');
$$;

create or replace function public.user_has_premium(p_user uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.tier_rank(public.user_tier(p_user)) >= public.tier_rank('standard');
$$;

-- ===========================================================================
-- 6. READING AN ENTITLEMENT
-- ===========================================================================

/**
 * One entitlement for the caller, for gates to ask. Returns null when the key
 * is not configured for their tier — callers must treat null as a refusal, not
 * as "unlimited".
 */
create or replace function public.my_entitlement(p_key text)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select e.value
    from public.plan_entitlements e
   where e.tier = public.my_tier()
     and e.key = p_key;
$$;

revoke all on function public.my_entitlement(text) from public, anon;
grant execute on function public.my_entitlement(text) to authenticated;

/** The same for somebody else — the gates that run against an album's owner
 *  rather than the caller (see album_owner_plan_id, 0032). */
create or replace function public.user_entitlement(p_user uuid, p_key text)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select e.value
    from public.plan_entitlements e
   where e.tier = public.user_tier(p_user)
     and e.key = p_key;
$$;

revoke all on function public.user_entitlement(uuid, text) from public, anon;
grant execute on function public.user_entitlement(uuid, text) to authenticated;

/**
 * Everything the client needs about billing in one round trip: which tier,
 * what it includes, and when a grant lapses.
 *
 * A single jsonb rather than `returns table`, because a RETURNS TABLE column
 * named `tier` collides with `plan_entitlements.tier` in the body and the
 * workaround (`#variable_conflict`, as admin_list_coupons needs) buys nothing
 * here.
 */
create or replace function public.my_billing_state()
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select jsonb_build_object(
    'tier', public.my_tier(),
    'premiumUntil', (
      select p.premium_until from public.profiles p where p.id = (select auth.uid())
    ),
    'entitlements', coalesce(
      (
        select jsonb_object_agg(e.key, e.value)
          from public.plan_entitlements e
         where e.tier = public.my_tier()
      ),
      '{}'::jsonb
    )
  );
$$;

revoke all on function public.my_billing_state() from public, anon;
grant execute on function public.my_billing_state() to authenticated;

-- ===========================================================================
-- 7. ADMIN
-- ===========================================================================

/** Additive rather than a new `admin_upsert_plan` signature: the pricing
 *  screen already calls the 8-argument version (0034) and changing it under a
 *  deployed client would break every price edit until the next release. */
create or replace function public.admin_set_plan_tier(p_id text, p_tier text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not an administrator' using errcode = 'insufficient_privilege';
  end if;
  if p_tier not in ('freemium', 'standard', 'premium') then
    raise exception 'invalid tier' using errcode = 'invalid_parameter_value';
  end if;

  update public.billing_plans
     set tier = p_tier,
         updated_at = (extract(epoch from now()) * 1000)::bigint
   where id = p_id;

  insert into public.admin_audit_log (actor, action, target_user, detail)
  values (auth.uid(), 'set_plan_tier', null, jsonb_build_object('plan_id', p_id, 'tier', p_tier));
end;
$$;

revoke all on function public.admin_set_plan_tier(text, text) from public, anon;
grant execute on function public.admin_set_plan_tier(text, text) to authenticated;

/** Owner-only, audited — same door as every other entitlement mutation. */
create or replace function public.admin_set_entitlement(
  p_tier text,
  p_key text,
  p_value jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_owner() then
    raise exception 'only the owner can change entitlements' using errcode = 'insufficient_privilege';
  end if;
  if p_tier not in ('freemium', 'standard', 'premium') then
    raise exception 'invalid tier' using errcode = 'invalid_parameter_value';
  end if;

  insert into public.plan_entitlements (tier, key, value, updated_at)
  values (p_tier, p_key, p_value, (extract(epoch from now()) * 1000)::bigint)
  on conflict (tier, key) do update
     set value = excluded.value,
         updated_at = excluded.updated_at;

  insert into public.admin_audit_log (actor, action, target_user, detail)
  values (
    auth.uid(), 'set_entitlement', null,
    jsonb_build_object('tier', p_tier, 'key', p_key, 'value', p_value)
  );
end;
$$;

revoke all on function public.admin_set_entitlement(text, text, jsonb) from public, anon;
grant execute on function public.admin_set_entitlement(text, text, jsonb) to authenticated;

-- `admin_grant_premium` gains a tier. Dropped and recreated rather than
-- overloaded because the 3-argument version has no callers anywhere in the app
-- (0052 shipped the RPC with no UI at all), so there is nothing to keep
-- working — and leaving both would make `rpc('admin_grant_premium', ...)`
-- ambiguous, since the new 4th argument has a default.
--
-- Both keep 0052's `returns jsonb`. `admin_revoke_premium` has to: its
-- signature is unchanged, and `create or replace` cannot alter a return type.
drop function if exists public.admin_grant_premium(uuid, bigint, text);

create or replace function public.admin_grant_premium(
  p_user_id uuid,
  p_until bigint,
  p_reason text,
  p_tier text default 'premium'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now bigint := (date_part('epoch', now()) * 1000)::bigint;
  v_until bigint;
  v_tier text;
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
  -- Granting `freemium` is not a grant, it is a demotion wearing a grant's
  -- clothes. `admin_revoke_premium` is how a grant ends.
  if p_tier not in ('standard', 'premium') then
    raise exception 'a grant must name standard or premium' using errcode = 'invalid_parameter_value';
  end if;

  insert into public.premium_grants (user_id, granted_by, until, reason, tier)
  values (p_user_id, auth.uid(), p_until, trim(p_reason), p_tier);

  /*
   * Two overlapping grants have to resolve to the stronger tier for the longer
   * window, so neither field simply takes the new value.
   *
   * `greatest` on the window is 0052's own semantics, kept deliberately: a
   * three-day gesture handed to somebody who already holds a year must not
   * shorten the year.
   *
   * The tier needs the mirror of that, and needs to ask whether the *existing*
   * grant is still live first. Without that liveness test, a lapsed premium
   * grant followed by a standard one would keep reading `premium` — the window
   * would be refreshed by the new grant while `granted_tier` still held the old
   * one, handing out a tier nobody granted.
   */
  update public.profiles
     set premium_until = greatest(coalesce(premium_until, 0), p_until),
         granted_tier = case
           when premium_until is not null
            and premium_until > v_now
            and public.tier_rank(coalesce(granted_tier, 'premium')) > public.tier_rank(p_tier)
           then granted_tier
           else p_tier
         end,
         updated_at = v_now
   where id = p_user_id
  returning premium_until, granted_tier into v_until, v_tier;

  if v_until is null then
    raise exception 'no such account' using errcode = 'no_data_found';
  end if;

  insert into public.admin_audit_log (actor, action, target_user, detail)
  values (
    auth.uid(), 'grant_premium', p_user_id,
    jsonb_build_object('until', p_until, 'reason', trim(p_reason), 'tier', p_tier)
  );

  return jsonb_build_object('ok', true, 'premiumUntil', v_until, 'tier', v_tier);
end;
$$;

revoke all on function public.admin_grant_premium(uuid, bigint, text, text) from public, anon;
grant execute on function public.admin_grant_premium(uuid, bigint, text, text) to authenticated;

-- Revoking has to clear the tier as well, or my_tier() keeps reading a
-- granted_tier that no longer has a window to live in.
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
     set revoked_at = now(),
         revoked_by = auth.uid()
   where user_id = p_user_id and revoked_at is null;

  -- Clears the tier as well as the window. Leaving `granted_tier` set would
  -- have `user_tier()` reading a tier with no window left to live in — and the
  -- next grant's liveness test above would then compare against it.
  update public.profiles
     set premium_until = null,
         granted_tier = null,
         updated_at = (date_part('epoch', now()) * 1000)::bigint
   where id = p_user_id;

  insert into public.admin_audit_log (actor, action, target_user, detail)
  values (auth.uid(), 'revoke_premium', p_user_id, '{}'::jsonb);

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.admin_revoke_premium(uuid) from public, anon;
grant execute on function public.admin_revoke_premium(uuid) to authenticated;

/** The grant history for one account. `premium_grants` has only a read-own
 *  policy (0052), so without this the owner cannot see what anybody else was
 *  given — which is the one question a free upgrade raises six months later. */
create or replace function public.admin_list_premium_grants(p_user_id uuid)
returns table (
  id uuid,
  granted_by uuid,
  until bigint,
  reason text,
  tier text,
  created_at timestamptz,
  revoked_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not public.is_owner() then
    raise exception 'only the owner can read premium grants' using errcode = 'insufficient_privilege';
  end if;

  return query
    select g.id, g.granted_by, g.until, g.reason, g.tier, g.created_at, g.revoked_at
      from public.premium_grants g
     where g.user_id = p_user_id
     order by g.created_at desc;
end;
$$;

revoke all on function public.admin_list_premium_grants(uuid) from public, anon;
grant execute on function public.admin_list_premium_grants(uuid) to authenticated;
