-- ---------------------------------------------------------------------------
-- 0073 — Two tiers, three intervals, and a price in the currency Safepay
--        actually charges.
--
-- ## What changes, and why each one
--
-- **Three tiers become two.** 0059 built `freemium / standard / premium`
-- against a product that had not decided how many it wanted, and the answer is
-- two: you either see ads or you do not. `standard` never sold — both of its
-- plan rows shipped inactive at price 0 and no account has ever been on one —
-- so it is dead configuration whose only remaining effect is a third column
-- every entitlement has to be defined for and a third value every check
-- constraint has to admit.
--
-- The two rows that *did* sell, `plus_monthly` and `plus_yearly`, were
-- backfilled onto `standard` by 0059. They move **up** to `premium`, not down.
-- Those are paying customers, and the migration that takes media backup away
-- from somebody who bought it is not a migration, it is a support incident.
-- They keep everything and gain whatever premium adds.
--
-- **A quarterly interval.** Monthly and yearly leave a gap that is the most
-- commonly chosen option in this market: long enough to be worth a discount,
-- short enough not to be a year's commitment on an app somebody has used for a
-- fortnight. `period` gains `'quarter'` and so does `admin_upsert_plan`, which
-- validates the list separately and would otherwise refuse the very rows this
-- file inserts.
--
-- **PKR, not USD.** The plans were priced $4.99 and $39.99. Safepay is a
-- Pakistani processor settling in PKR, and the app ships `en · ur · hi · ar` —
-- so the currency the prices were written in was neither the one the processor
-- charges nor the one the primary market earns. A dollar price also converts at
-- whatever rate Safepay picks on the day, which makes the number on the paywall
-- and the number on the bank statement two different numbers.
--
-- `price_cents` stays minor units, which for PKR is paisa: Rs 349 is 34900.
-- `toSafepayAmount` (functions/_shared/money.ts) divides by 100 on the way out,
-- so nothing about that conversion changes.
--
-- **Storage is not what these buy.** The subscription is ad removal plus the
-- media capabilities premium already carried; *additional* storage is a
-- separate, admin-priced thing (`admin_upsert_plan` has taken a
-- `storage_bytes` for that purpose since 0034). The entitlement matrix is
-- therefore untouched apart from deleting the `standard` column — nobody's
-- capabilities move except the `standard` users being promoted.
--
-- ## The ladder
--
--   Monthly     Rs   349          — the impulse price
--   Quarterly   Rs   929  ≈ 310/mo, 11% off
--   Yearly      Rs 3,149  ≈ 262/mo, 25% off
--
-- The discounts are deliberate and conventional: enough that yearly is clearly
-- the best value, not so much that monthly reads as a penalty for not
-- committing. A subscription whose monthly option feels like a punishment
-- converts worse overall, because monthly is how most people start.
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- 1. FOLD `standard` INTO `premium`
--
-- Data first, constraints second. Tightening a check while rows still violate
-- it fails the migration, and doing it in this order means the constraint is
-- only ever applied to data that already satisfies it.
-- ===========================================================================

update public.billing_plans set tier = 'premium', updated_at = (extract(epoch from now()) * 1000)::bigint
 where tier = 'standard';

update public.premium_grants set tier = 'premium' where tier = 'standard';

update public.profiles
   set granted_tier = 'premium',
       updated_at = (extract(epoch from now()) * 1000)::bigint
 where granted_tier = 'standard';

/*
 * The entitlement rows go, rather than being merged.
 *
 * 0059's completeness check guarantees `premium` already defines every key, so
 * there is nothing in the `standard` column that premium does not have its own
 * answer for. Merging would mean picking a winner per cell, and the winner
 * would be premium's every time.
 */
delete from public.plan_entitlements where tier = 'standard';

-- ===========================================================================
-- 2. TWO TIERS, ENFORCED
-- ===========================================================================

alter table public.billing_plans drop constraint if exists billing_plans_tier_check;
alter table public.billing_plans
  add constraint billing_plans_tier_check check (tier in ('freemium', 'premium'));

alter table public.plan_entitlements drop constraint if exists plan_entitlements_tier_check;
alter table public.plan_entitlements
  add constraint plan_entitlements_tier_check check (tier in ('freemium', 'premium'));

alter table public.premium_grants drop constraint if exists premium_grants_tier_check;
alter table public.premium_grants
  add constraint premium_grants_tier_check check (tier in ('freemium', 'premium'));

alter table public.profiles drop constraint if exists profiles_granted_tier_check;
alter table public.profiles
  add constraint profiles_granted_tier_check
  check (granted_tier is null or granted_tier in ('freemium', 'premium'));

/*
 * `tier_rank` loses its middle rung.
 *
 * Unknown still ranks 0 — the weakest, never accidentally the strongest, which
 * is the only safe direction for a value that arrives over the wire. That now
 * covers `'standard'` too: a client built before this migration sending it gets
 * the weakest answer rather than a paid one.
 */
create or replace function public.tier_rank(p_tier text)
returns integer
language sql
immutable
as $$
  select case p_tier
    when 'freemium' then 1
    when 'premium'  then 2
    else 0
  end;
$$;

-- ===========================================================================
-- 3. A QUARTERLY INTERVAL
-- ===========================================================================

alter table public.billing_plans drop constraint if exists billing_plans_period_check;
alter table public.billing_plans
  add constraint billing_plans_period_check
  check (period in ('free', 'month', 'quarter', 'year'));

/*
 * `admin_upsert_plan` validates the period against its own hardcoded list, so
 * widening the table constraint alone would leave the console unable to create
 * the very rows this file inserts — the constraint and the RPC are two copies
 * of one rule and both have to move.
 *
 * Everything else about the function is 0034's, unchanged.
 */
create or replace function public.admin_upsert_plan(
  p_id text,
  p_name text,
  p_storage_bytes bigint,
  p_price_cents integer,
  p_currency text,
  p_period text,
  p_badge text,
  p_sort_order integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not an administrator' using errcode = 'insufficient_privilege';
  end if;
  if p_period not in ('free', 'month', 'quarter', 'year') then
    raise exception 'invalid period' using errcode = 'invalid_parameter_value';
  end if;

  insert into public.billing_plans
    (id, name, storage_bytes, price_cents, currency, period, badge, sort_order, active, created_at, updated_at)
  values
    (p_id, p_name, p_storage_bytes, p_price_cents, coalesce(p_currency, 'usd'), p_period, p_badge,
     coalesce(p_sort_order, 0), true, (extract(epoch from now()) * 1000)::bigint,
     (extract(epoch from now()) * 1000)::bigint)
  on conflict (id) do update
    set name = excluded.name,
        storage_bytes = excluded.storage_bytes,
        price_cents = excluded.price_cents,
        currency = excluded.currency,
        period = excluded.period,
        badge = excluded.badge,
        sort_order = excluded.sort_order,
        updated_at = excluded.updated_at;

  insert into public.admin_audit_log (actor, action, target_user, detail)
  values (
    auth.uid(), 'upsert_plan', null,
    jsonb_build_object('id', p_id, 'price_cents', p_price_cents, 'storage_bytes', p_storage_bytes)
  );
end;
$$;

revoke all on function public.admin_upsert_plan(text, text, bigint, integer, text, text, text, integer)
  from public, anon;
grant execute on function public.admin_upsert_plan(text, text, bigint, integer, text, text, text, integer)
  to authenticated;

/*
 * `has_premium()` compared against the tier that just stopped existing.
 *
 * 0059 wrote it as `tier_rank(my_tier()) >= tier_rank('standard')` — "paid"
 * meaning "at least the cheapest paid tier", which was right while `standard`
 * was one. The moment section 2 above drops `standard` out of `tier_rank`, that
 * call returns **0**, and the whole expression becomes `>= 0`: true for
 * everybody, forever.
 *
 * Three triggers gate on this — avatar upload (0052), album media (0052) and
 * voice notes (0054) — so the silent effect of not fixing it here is every free
 * account in the product quietly acquiring all three, with the paywall still
 * rendering as though they had not. Nothing would have raised an error; the
 * gates would simply have stopped gating.
 *
 * It is the exact hazard `tier_rank`'s own comment warns about pointed the
 * other way: flooring an unknown tier at 0 is the safe direction for the value
 * being *ranked*, and the unsafe direction for a value being used as a
 * *threshold*. With two tiers the threshold has one honest name.
 */
create or replace function public.has_premium()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.tier_rank(public.my_tier()) >= public.tier_rank('premium');
$$;

create or replace function public.user_has_premium(p_user uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.tier_rank(public.user_tier(p_user)) >= public.tier_rank('premium');
$$;

/*
 * `admin_grant_premium` validates the tier it is handed against its own list,
 * and that list still named `standard`.
 *
 * Left alone, a grant naming the retired tier passed the function's check and
 * then died on the constraint — so the operator got "violates check constraint
 * premium_grants_tier_check" instead of the sentence the function exists to
 * say. Worse, the two disagreed about what a legal tier is, which is the shape
 * of bug where one of them later gets "fixed" to match the other.
 *
 * `freemium` stays refused for 0059's own reason: granting it is a demotion
 * wearing a grant's clothes, and `admin_revoke_premium` is how a grant ends.
 * That leaves exactly one grantable tier, which is what two tiers means.
 */
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
  if p_tier <> 'premium' then
    raise exception 'a grant must name premium' using errcode = 'invalid_parameter_value';
  end if;

  insert into public.premium_grants (user_id, granted_by, until, reason, tier)
  values (p_user_id, auth.uid(), p_until, trim(p_reason), p_tier);

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

-- ===========================================================================
-- 4. THE PLAN ROWS PEOPLE CAN ACTUALLY BUY
-- ===========================================================================

/*
 * The two `standard_*` rows are deleted rather than archived.
 *
 * Archiving is the right default and it is what the legacy rows below get,
 * because an archived plan stays valid for whoever is on it. Nobody is on
 * these: both shipped `active = false` at `price_cents = 0` and there has never
 * been a way to select one. Keeping them would leave two rows describing a tier
 * that no longer exists, in a table an operator edits by hand.
 *
 * Guarded on the foreign key anyway. If some account *is* pointing at one, the
 * delete is skipped and the row is archived instead — a failed migration is a
 * better outcome than an orphaned `plan_id`, and no outcome at all is better
 * than either.
 */
update public.billing_plans
   set active = false, updated_at = (extract(epoch from now()) * 1000)::bigint
 where id in ('standard_monthly', 'standard_yearly');

delete from public.billing_plans
 where id in ('standard_monthly', 'standard_yearly')
   and not exists (select 1 from public.profiles p where p.plan_id = billing_plans.id);

/*
 * `plus_monthly` and `plus_yearly` are archived, not deleted.
 *
 * These are the rows that actually sold. Their subscribers keep them — an
 * archived plan is honoured, it is simply never offered to somebody choosing —
 * and they now sit on `premium`, so those accounts read as premium everywhere
 * `user_tier()` is asked. They stop appearing on the paywall, which is the only
 * thing that should change for them.
 */
update public.billing_plans
   set active = false,
       updated_at = (extract(epoch from now()) * 1000)::bigint
 where id in ('plus_monthly', 'plus_yearly');

/*
 * The three that are on sale.
 *
 * `storage_bytes` matches what premium already carried (100 GB), because
 * `media_quota_bytes()` still reads this column for accounts on a plan — the
 * subscription is not *sold* on storage, which is a different statement from
 * the subscription granting none.
 *
 * `on conflict do update` rather than `do nothing`: 0059 seeded
 * `premium_monthly` and `premium_yearly` as inactive placeholders at price 0,
 * and those are exactly the rows that need the price and the switch.
 */
insert into public.billing_plans
  (id, name, tier, storage_bytes, price_cents, currency, period, badge, sort_order, active, created_at, updated_at)
values
  ('premium_monthly',   'Premium', 'premium', 107374182400,  34900, 'pkr', 'month',   null,
   1, true, (extract(epoch from now()) * 1000)::bigint, (extract(epoch from now()) * 1000)::bigint),
  ('premium_quarterly', 'Premium', 'premium', 107374182400,  92900, 'pkr', 'quarter', null,
   2, true, (extract(epoch from now()) * 1000)::bigint, (extract(epoch from now()) * 1000)::bigint),
  ('premium_yearly',    'Premium', 'premium', 107374182400, 314900, 'pkr', 'year',    'best_value',
   3, true, (extract(epoch from now()) * 1000)::bigint, (extract(epoch from now()) * 1000)::bigint)
on conflict (id) do update
  set name = excluded.name,
      tier = excluded.tier,
      storage_bytes = excluded.storage_bytes,
      price_cents = excluded.price_cents,
      currency = excluded.currency,
      period = excluded.period,
      badge = excluded.badge,
      sort_order = excluded.sort_order,
      active = excluded.active,
      updated_at = excluded.updated_at;

-- The free row keeps its id and its tier; only the sort order matters now that
-- it sits at the head of a four-row list rather than a five-row one.
update public.billing_plans
   set sort_order = 0,
       updated_at = (extract(epoch from now()) * 1000)::bigint
 where id = 'free';

-- ===========================================================================
-- 5. THE SAME COMPLETENESS CHECK, FOR TWO TIERS
--
-- A missing cell resolves to null and a null entitlement denies, so the failure
-- mode of a typo above is a paying customer silently refused a feature they
-- bought. 0059 checked three tiers; checking three now would fail on the column
-- this migration just removed, so the check moves with the tiers it guards.
-- ===========================================================================

do $$
declare
  v_missing text;
begin
  select string_agg(t.tier || '.' || k.key, ', ')
    into v_missing
    from (select unnest(array['freemium', 'premium']) as tier) t
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

-- And nothing may still be pointing at the tier that no longer exists.
do $$
declare
  v_left integer;
begin
  select count(*) into v_left from public.plan_entitlements where tier = 'standard';
  if v_left > 0 then
    raise exception 'plan_entitlements still defines % standard rows', v_left;
  end if;

  select count(*) into v_left from public.billing_plans where tier not in ('freemium', 'premium');
  if v_left > 0 then
    raise exception 'billing_plans still has % rows on an unknown tier', v_left;
  end if;
end;
$$;

-- ===========================================================================
-- 6. THE ANNUAL PERK STOPS NAMING A PLAN ID
--
-- Unchanged from 0070 except for the perk condition — see the comment inside.
-- ===========================================================================

create or replace function public.enroll_in_challenge(
  p_season uuid,
  p_tz_offset_minutes integer,
  p_required text[],
  p_extra text[],
  p_device_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.challenge_seasons%rowtype;
  v_uid uuid := auth.uid();
  v_today date;
  v_extras integer;
  v_bonus integer;
  v_plan text;
  v_days integer;
  v_shields integer := 0;
  v_enrolled integer;
  v_ends date;
  v_bad text;
  m text;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = 'insufficient_privilege';
  end if;

  select * into s from public.challenge_seasons where id = p_season;
  if not found or not s.enabled then
    raise exception 'season is not open';
  end if;
  -- The enrolment window. Unchanged, and now saying precisely what it means.
  if (s.starts_at is not null and now() < s.starts_at)
     or (s.ends_at is not null and now() > s.ends_at) then
    raise exception 'season is not open';
  end if;

  if exists (select 1 from public.challenge_enrollments
              where user_id = v_uid and status = 'active') then
    raise exception 'already in a run';
  end if;

  if s.max_enrollments is not null then
    select count(*)::int into v_enrolled
      from public.challenge_enrollments where season_id = p_season;
    if v_enrolled >= s.max_enrollments then
      raise exception 'season is full';
    end if;
  end if;

  if coalesce(array_length(p_required, 1), 0) < s.required_modules then
    raise exception 'pick at least % modules', s.required_modules;
  end if;

  -- Every named module must be eligible this season, required or extra alike.
  foreach m in array (coalesce(p_required, '{}'::text[]) || coalesce(p_extra, '{}'::text[]))
  loop
    if not exists (select 1 from public.challenge_modules
                    where season_id = p_season and module_id = m and eligible) then
      v_bad := m;
      raise exception 'module % may not be committed to this season', v_bad;
    end if;
  end loop;

  -- One live run per device, on top of 0047's one-account-one-device rule.
  -- Together they are what stop the cheapest multi-account farm.
  if p_device_id is not null and exists (
    select 1 from public.challenge_enrollments
     where device_id = p_device_id and status = 'active' and user_id <> v_uid
  ) then
    raise exception 'this device already has a run';
  end if;

  v_today := public.challenge_local_day(now(), p_tz_offset_minutes, s.day_grace_hours);
  v_extras := coalesce(array_length(p_extra, 1), 0);
  v_bonus := case when v_extras >= 2 then 5 when v_extras = 1 then 3 else 0 end;

  /*
   * The annual-subscriber perk, keyed off the plan's PERIOD rather than its id.
   *
   * It read `v_plan = 'plus_yearly'` — a hardcoded plan id, which 0073 renames.
   * Left alone it would have gone on compiling, gone on enrolling people, and
   * silently stopped granting the head start to every annual subscriber from
   * the day the new plans went on sale. Nothing would have failed; the perk
   * would simply never have fired again.
   *
   * A period is what the rule was always about — REWARDS_PROGRAM §2.3 calls it
   * "the annual-plan perk" — and it survives the next rename too. Quarterly is
   * deliberately not included: the documented edge is a head start for the
   * year-long commitment, and widening it is a product decision rather than a
   * migration's to make.
   */
  select p.plan_id into v_plan from public.profiles p where p.id = v_uid;
  if exists (
    select 1 from public.billing_plans b
     where b.id = v_plan and b.period = 'year'
  ) then
    v_bonus := v_bonus + 5;
    v_shields := 1;
  end if;

  v_days := greatest(s.shield_earn_days - v_bonus, s.shield_floor_days);
  v_ends := public.challenge_run_end_day(p_season, v_today, p_tz_offset_minutes);

  insert into public.challenge_enrollments (
    user_id, season_id, enrolled_local_day, last_settled_day, tz_offset_minutes,
    shields, shield_earn_days, plan_at_enrolment, device_id, run_ends_on
  ) values (
    v_uid, p_season, v_today, v_today - 1, p_tz_offset_minutes,
    least(v_shields, s.shield_cap), v_days, v_plan, p_device_id, v_ends
  );

  insert into public.challenge_enrollment_modules
    (user_id, season_id, module_id, role, added_on)
  select v_uid, p_season, x, 'required', v_today
    from unnest(coalesce(p_required, '{}'::text[])) as x;

  insert into public.challenge_enrollment_modules
    (user_id, season_id, module_id, role, added_on)
  select v_uid, p_season, x, 'extra', v_today
    from unnest(coalesce(p_extra, '{}'::text[])) as x
   where not x = any (coalesce(p_required, '{}'::text[]));

  insert into public.challenge_events (user_id, season_id, kind, detail)
  values (v_uid, p_season, 'enrolled', jsonb_build_object(
    'required', to_jsonb(coalesce(p_required, '{}'::text[])),
    'extra', to_jsonb(coalesce(p_extra, '{}'::text[])),
    'shieldEarnDays', v_days,
    'runEndsOn', v_ends
  ));

  return jsonb_build_object(
    'ok', true, 'localDay', v_today, 'shieldEarnDays', v_days,
    'shields', least(v_shields, s.shield_cap),
    'runEndsOn', v_ends
  );
end;
$$;
