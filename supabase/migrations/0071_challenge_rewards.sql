-- ---------------------------------------------------------------------------
-- 0071 — The ladder starts paying out.
--
-- ## The gap this closes
--
-- `challenge_tiers` has carried `reward_title` and `reward_description` since
-- 0048, and both are **prose**. Reaching Ember on day thirty wrote a
-- `tier_reached` event, the client raised a toast, and nothing else happened
-- anywhere: no badge, no cosmetic, no entitlement, nothing the user could look
-- at the next morning. The ladder was a promise the engine had no way of
-- keeping, and the longer somebody climbed it the more obviously so.
--
-- This migration gives a rung an **effect**. `challenge_tiers.rewards` is a
-- jsonb array of them, so a season's payouts are data an operator edits rather
-- than a constant somebody has to ship a build to change — the same reasoning
-- that made the ladder itself a table.
--
-- ## The ledger is the idempotency key
--
-- Every effect writes one row into `user_rewards` before it does anything, and
-- **the side effect only runs when that insert actually took**. That single
-- rule is what makes the whole thing safe to call more than once, which it
-- will be:
--
--   * `current_tier_day` *decreases* on a demotion (0048), so re-climbing to a
--     rung fires `tier_reached` a second time. §1.1 of REWARDS_PROGRAM is
--     explicit that a badge already unlocked is never taken back — so the
--     second pass must be a no-op, not a second badge and certainly not a
--     second month of premium.
--   * `sync_my_challenge_rewards()` below deliberately lets the client ask
--     again, so a payout missed to a crash or a bad deploy heals on the next
--     screen open instead of needing an operator.
--
-- `unique (user_id, slug)` is therefore load-bearing rather than tidy.
--
-- ## Two kinds of slug, because there are two kinds of reward
--
-- A **cosmetic** — badge, theme, chain colour, profile frame, app icon — is
-- keyed by what it is: `badge:spark`. Owning it twice is meaningless, so
-- earning Spark in a second season grants nothing, which is correct and is
-- also a warning to whoever writes season two: give it its own cosmetics or its
-- returning players get an empty rung.
--
-- A **consumable** — a premium window, a shield — is keyed by where it was
-- earned: `premium:<season>:<rung>`. Each season's rung pays out once, and the
-- next season's equivalent rung is a different row.
--
-- ## Premium comes through the audited door
--
-- Not a second entitlement path. A rung's premium window is written into
-- `premium_grants` exactly as an owner's gesture is (0052, retiered in 0059),
-- so "who gave this away, when, and why" has one answer for both — and the
-- expiry logic, the overlapping-grant merge and `user_tier()` need no idea that
-- the streak engine exists. `granted_by` becomes nullable, and null there now
-- means *the engine*, which is the honest way to say "no person did this".
--
-- The merge itself moves into `grant_premium_window()` and `admin_grant_premium`
-- is rewritten to call it, rather than the two carrying a copy each. Two
-- functions deriving "what does this grant leave the account holding" from the
-- same columns is precisely the drift 0055's header warned about.
--
-- ## Rule 0.1 is intact, and is still an absence
--
-- There is no function here that an advertising callback can reach. The only
-- callers of the granter are `challenge_credit_day` — which runs when a day is
-- *earned* — and the user's own idempotent resync, which can only re-derive
-- payouts from days already in the ledger. Nothing in this file can turn
-- attention into progress, and nothing added to it ever may.
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- 1. SCHEMA
-- ===========================================================================

/*
 * A rung's payout, as data.
 *
 * An array rather than a column per effect, because a rung pays out several
 * things at once ("badge, app icon, and your first shield") and the set of
 * *kinds* is a product decision that will move. Shape, one object per effect:
 *
 *   {"kind":"badge",   "slug":"ember"}
 *   {"kind":"theme",   "slug":"ember-gradient"}
 *   {"kind":"chain",   "slug":"molten"}
 *   {"kind":"frame",   "slug":"ember-ring"}
 *   {"kind":"icon",    "slug":"ember-mark"}
 *   {"kind":"shield",  "count":1}
 *   {"kind":"premium", "days":7, "tier":"premium"}
 *
 * `icon` is accepted and **nothing seeds it**. Swapping the launcher icon needs
 * an alternate-icon set declared at build time, which this app does not have,
 * and a rung that grants an icon the launcher never shows is exactly the empty
 * promise the seed below was rewritten to remove. The branch stays because it
 * costs one line and the day that build config lands, the reward is data.
 *
 * Validated by `challenge_reward_effect_ok` at the point of payout rather than
 * by a check constraint over the array's contents — the constraint would have
 * to be rewritten every time a kind is added, and an operator pasting a typo
 * into the console should lose that one effect rather than have the whole tier
 * refuse to save.
 */
alter table public.challenge_tiers
  add column if not exists rewards jsonb not null default '[]'::jsonb;

alter table public.challenge_tiers
  drop constraint if exists challenge_tiers_rewards_is_array;

alter table public.challenge_tiers
  add constraint challenge_tiers_rewards_is_array
  check (jsonb_typeof(rewards) = 'array');

comment on column public.challenge_tiers.rewards is
  'Array of effect objects paid out when this rung is first reached. See 0071.';

/*
 * `granted_by` becomes nullable, and null means the streak engine.
 *
 * The alternative was to stamp the user themselves as the granter, which reads
 * in the audit trail as somebody having given premium to themselves — the one
 * sentence that table exists to make impossible to write.
 */
alter table public.premium_grants
  alter column granted_by drop not null;

comment on column public.premium_grants.granted_by is
  'The admin who made the grant, or null when the streak engine did (0071). '
  'The reason column then carries challenge:<season>:<rung>.';

/**
 * What somebody has earned, permanently.
 *
 * Owner-read only, and — like every table in 0048 — with **no insert or update
 * policy at any point in this file**. A cosmetic the client could award itself
 * is a cosmetic worth nothing, and the whole value of a badge is that the only
 * way to hold one is to have done the thing.
 *
 * `revoked_at` exists and is never set by anything here. It is for the one case
 * §6 of REWARDS_PROGRAM anticipates — a run found to have been faked — and a
 * row is closed rather than deleted so the record of the award survives its
 * withdrawal, the same shape `premium_grants` uses.
 */
create table if not exists public.user_rewards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  /** `kind:slug` for a cosmetic, `kind:season:rung` for a consumable. The
   *  uniqueness of this string is the exactly-once guarantee. */
  slug text not null,
  kind text not null,
  /** Where it was earned. Null is allowed so a future non-challenge source —
   *  a referral, a gesture from support — can use the same shelf. */
  season_id uuid references public.challenge_seasons(id) on delete set null,
  tier_day integer,
  /** The effect as it was written on the rung, kept verbatim. An operator
   *  editing next season's payout must not change what last season's says it
   *  gave somebody. */
  detail jsonb not null default '{}'::jsonb,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (user_id, slug)
);

create index if not exists user_rewards_user_idx
  on public.user_rewards (user_id, granted_at desc);

alter table public.user_rewards enable row level security;

drop policy if exists user_rewards_read_own on public.user_rewards;
create policy user_rewards_read_own on public.user_rewards
  for select using (user_id = (select auth.uid()) or public.is_admin());

/*
 * The timeline gains a beat for the payout.
 *
 * Separate from `tier_reached` even though they usually arrive together,
 * because they are not the same fact and one can happen without the other: a
 * returning player re-reaching Spark reaches a rung and is paid nothing. A
 * timeline that inferred the payout from the rung would tell that person they
 * had been given a theme they never received.
 */
alter table public.challenge_events
  drop constraint if exists challenge_events_kind_check;

alter table public.challenge_events
  add constraint challenge_events_kind_check
  check (kind in (
    'enrolled', 'tier_reached', 'shield_earned', 'shield_spent', 'demoted',
    'module_swapped', 'completed', 'season_ended', 'reward_granted',
    'admin_shield_granted', 'admin_days_restored'
  ));

-- ===========================================================================
-- 2. THE PREMIUM WINDOW, DERIVED ONCE
-- ===========================================================================

/**
 * Applies a premium window to an account, and records it.
 *
 * Lifted verbatim out of `admin_grant_premium` (0059) so that both callers —
 * the owner's gesture and a rung's payout — resolve overlapping grants the same
 * way. The rules it carries, and why neither is obvious:
 *
 *   * **`greatest` on the window.** 0052's own semantics: a seven-day rung
 *     handed to somebody who already holds a year must not shorten the year.
 *   * **The liveness test on the tier.** A lapsed premium grant followed by a
 *     standard one must not keep reading `premium` — without the test the
 *     window is refreshed by the new grant while `granted_tier` still holds the
 *     old one, handing out a tier nobody granted.
 *
 * No authorisation of its own, deliberately, and execute is granted to nobody:
 * this is a body two callers share, and each does its own gating. It is
 * reachable only from a SECURITY DEFINER function that has already decided the
 * caller may be here.
 */
create or replace function public.grant_premium_window(
  p_user_id uuid,
  p_until bigint,
  p_reason text,
  p_tier text,
  p_granted_by uuid
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
  values (p_user_id, p_granted_by, p_until, trim(p_reason), p_tier);

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

  return jsonb_build_object('ok', true, 'premiumUntil', v_until, 'tier', v_tier);
end;
$$;

revoke all on function public.grant_premium_window(uuid, bigint, text, text, uuid)
  from public, anon, authenticated;

/*
 * `admin_grant_premium` keeps its signature, its guard and its audit row, and
 * loses its copy of the merge. Same behaviour, one derivation.
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
  v_result jsonb;
begin
  if not public.is_owner() then
    raise exception 'only the owner may grant premium' using errcode = 'insufficient_privilege';
  end if;

  v_result := public.grant_premium_window(p_user_id, p_until, p_reason, p_tier, auth.uid());

  insert into public.admin_audit_log (actor, action, target_user, detail)
  values (
    auth.uid(), 'grant_premium', p_user_id,
    jsonb_build_object('until', p_until, 'reason', trim(p_reason), 'tier', p_tier)
  );

  return v_result;
end;
$$;

revoke all on function public.admin_grant_premium(uuid, bigint, text, text) from public, anon;
grant execute on function public.admin_grant_premium(uuid, bigint, text, text) to authenticated;

-- ===========================================================================
-- 3. PAYING OUT ONE EFFECT
-- ===========================================================================

/**
 * Whether an effect object is something this engine knows how to pay.
 *
 * A rung carrying an unrecognised effect loses that line and keeps the rest,
 * rather than failing the day that reached it. The console shows the same
 * verdict before saving, so a typo is caught by the person who made it instead
 * of by the user who did not get their badge.
 */
create or replace function public.challenge_reward_effect_ok(p_effect jsonb)
returns boolean
language sql
immutable
as $$
  select case p_effect->>'kind'
    when 'badge'   then coalesce(length(p_effect->>'slug'), 0) > 0
    when 'theme'   then coalesce(length(p_effect->>'slug'), 0) > 0
    when 'chain'   then coalesce(length(p_effect->>'slug'), 0) > 0
    when 'frame'   then coalesce(length(p_effect->>'slug'), 0) > 0
    when 'icon'    then coalesce(length(p_effect->>'slug'), 0) > 0
    when 'shield'  then coalesce((p_effect->>'count')::int, 0) between 1 and 3
    when 'premium' then coalesce((p_effect->>'days')::int, 0) between 1 and 365
                    and coalesce(p_effect->>'tier', 'premium') in ('standard', 'premium')
    else false
  end;
$$;

/**
 * Pays out one effect, once.
 *
 * Returns the slug when the payout was new and null when it had already
 * happened — which is what lets the caller build an honest "you just received"
 * list rather than replaying somebody's whole shelf at them every time they
 * re-reach a rung.
 *
 * The order inside is the whole design: **insert first, act second.** The
 * unique index does the arbitration, under whatever concurrency two devices
 * crediting the same day can produce, and a side effect that ran before its
 * ledger row could run twice for one rung. Premium is the effect where that
 * difference is measured in money.
 */
create or replace function public.challenge_apply_reward(
  p_user uuid,
  p_season uuid,
  p_tier_day integer,
  p_effect jsonb
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind text := p_effect->>'kind';
  v_slug text;
  v_days integer;
  v_count integer;
  v_cap integer;
  v_held integer;
begin
  if not public.challenge_reward_effect_ok(p_effect) then
    return null;
  end if;

  -- A cosmetic is keyed by what it is; a consumable by where it was earned.
  -- See the header for why the two cannot share a rule.
  if v_kind in ('badge', 'theme', 'chain', 'frame', 'icon') then
    v_slug := v_kind || ':' || (p_effect->>'slug');
  else
    v_slug := v_kind || ':' || coalesce(p_season::text, 'none') || ':' || coalesce(p_tier_day, 0);
  end if;

  insert into public.user_rewards (user_id, slug, kind, season_id, tier_day, detail)
  values (p_user, v_slug, v_kind, p_season, p_tier_day, p_effect)
  on conflict (user_id, slug) do nothing;

  -- Already held. Nothing to do, and nothing to tell the user about.
  if not found then
    return null;
  end if;

  if v_kind = 'premium' then
    v_days := (p_effect->>'days')::int;
    perform public.grant_premium_window(
      p_user,
      ((date_part('epoch', now()) * 1000)::bigint + (v_days::bigint * 86400000)),
      'challenge:' || coalesce(p_season::text, 'none') || ':' || coalesce(p_tier_day, 0),
      coalesce(p_effect->>'tier', 'premium'),
      null
    );

  elsif v_kind = 'shield' then
    v_count := (p_effect->>'count')::int;
    /*
     * The cap still applies. §1.3 is unconditional about it — no fourth slot at
     * any rung, no exception — and a rung that quietly handed out a fourth
     * would be the exception, however small. Somebody already holding three
     * gets the ledger row and no shield, which is the same deal
     * `admin_grant_challenge_shield` gives.
     */
    select s.shield_cap into v_cap
      from public.challenge_seasons s where s.id = p_season;
    select e.shields into v_held
      from public.challenge_enrollments e
     where e.user_id = p_user and e.season_id = p_season;

    if v_cap is not null and v_held is not null and v_held < v_cap then
      update public.challenge_enrollments
         set shields = least(v_held + v_count, v_cap),
             shields_earned = shields_earned + least(v_count, v_cap - v_held),
             updated_at = now()
       where user_id = p_user and season_id = p_season;
    end if;
  end if;

  return v_slug;
end;
$$;

revoke all on function public.challenge_apply_reward(uuid, uuid, integer, jsonb)
  from public, anon, authenticated;

-- ===========================================================================
-- 4. PAYING OUT EVERY RUNG SOMEBODY HAS PASSED
-- ===========================================================================

/**
 * Grants everything owed for a run at `p_qualified_days`, and says what was new.
 *
 * Walks **every** rung at or below the day count rather than only the one just
 * reached. That is not defensive padding: a run restored by
 * `admin_restore_challenge_days`, a season whose ladder gained a rung after
 * people had already passed its threshold, and a payout lost to a failed
 * transaction all leave somebody standing above a rung they were never paid
 * for. Walking the lot makes every one of those heal on the next qualified day
 * instead of waiting for an operator to notice.
 *
 * Cheap enough to do exactly that: nine rungs, a handful of effects each, all
 * of it swallowed by the unique index after the first time.
 */
create or replace function public.challenge_grant_tier_rewards(
  p_user uuid,
  p_season uuid,
  p_qualified_days integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t record;
  v_effect jsonb;
  v_slug text;
  v_new text[] := '{}';
begin
  for t in
    select day_threshold, rewards
      from public.challenge_tiers
     where season_id = p_season
       and day_threshold <= coalesce(p_qualified_days, 0)
     order by day_threshold
  loop
    for v_effect in select * from jsonb_array_elements(t.rewards)
    loop
      v_slug := public.challenge_apply_reward(p_user, p_season, t.day_threshold, v_effect);
      if v_slug is not null then
        v_new := array_append(v_new, v_slug);
      end if;
    end loop;
  end loop;

  -- One event for the batch, not one per effect. A rung that pays a badge, a
  -- theme and a shield is one thing that happened to the user, and three
  -- timeline entries for it would bury the day it sits next to.
  if array_length(v_new, 1) > 0 then
    insert into public.challenge_events (user_id, season_id, kind, detail)
    values (p_user, p_season, 'reward_granted',
            jsonb_build_object('slugs', to_jsonb(v_new), 'qualifiedDays', p_qualified_days));
  end if;

  return to_jsonb(v_new);
end;
$$;

revoke all on function public.challenge_grant_tier_rewards(uuid, uuid, integer)
  from public, anon, authenticated;

-- ===========================================================================
-- 5. CREDITING A DAY PAYS FOR IT
-- ===========================================================================

/**
 * Unchanged from 0048 except for the payout at the end.
 *
 * The call sits **after** the enrolment row has been written back, not next to
 * the `tier_reached` event that inspired it. Two reasons, and the second is the
 * one that would have hurt:
 *
 *   * `challenge_apply_reward` writes to `challenge_enrollments` itself when
 *     the effect is a shield, and the row-variable `e` in this function is a
 *     snapshot taken at the top. Paying out before the update would have this
 *     function's `update ... set shields = e.shields` overwrite a shield it had
 *     just been granted — a rung that gives a shield and takes it back in the
 *     same statement.
 *   * It runs on `qualified_days`, which is only final once the tier and
 *     completion blocks above have had their say.
 *
 * The payout is not conditional on the tier having *advanced*. A day that
 * crosses no new rung normally grants nothing and costs one indexed lookup per
 * rung; a day that crosses one where a previous payout was lost grants the
 * arrears. See `challenge_grant_tier_rewards` for why that is worth the lookup.
 */
create or replace function public.challenge_credit_day(
  p_user uuid,
  p_season uuid,
  p_local_day date,
  p_modules_hit text[],
  p_active_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  e public.challenge_enrollments%rowtype;
  s public.challenge_seasons%rowtype;
  v_tier integer;
  v_final integer;
  v_earned boolean := false;
  v_rewards jsonb := '[]'::jsonb;
begin
  select * into e
    from public.challenge_enrollments
   where user_id = p_user and season_id = p_season
     for update;
  if not found or e.status <> 'active' then
    return jsonb_build_object('ok', false, 'reason', 'no active run');
  end if;

  select * into s from public.challenge_seasons where id = p_season;

  insert into public.challenge_days
    (user_id, season_id, local_day, outcome, modules_hit, active_seconds)
  values
    (p_user, p_season, p_local_day, 'qualified',
     coalesce(p_modules_hit, '{}'::text[]), coalesce(p_active_seconds, 0))
  on conflict (user_id, season_id, local_day) do nothing;

  -- FOUND is false when the conflict swallowed the insert, which is precisely
  -- the "already counted" case and must not advance anything.
  if not found then
    return jsonb_build_object(
      'ok', true, 'qualified', true, 'alreadyCounted', true,
      'qualifiedDays', e.qualified_days, 'shields', e.shields
    );
  end if;

  e.qualified_days := e.qualified_days + 1;
  e.perfect_run := e.perfect_run + 1;

  -- A shield every N clean days, and never a fourth one. The cap is what makes
  -- the third feel like the last.
  if e.perfect_run % e.shield_earn_days = 0 and e.shields < s.shield_cap then
    e.shields := e.shields + 1;
    e.shields_earned := e.shields_earned + 1;
    v_earned := true;
    insert into public.challenge_events (user_id, season_id, kind, detail)
    values (p_user, p_season, 'shield_earned',
            jsonb_build_object('shields', e.shields, 'perfectRun', e.perfect_run));
  end if;

  -- Misses age out. Being in the program longer must not make somebody
  -- permanently more fragile than a newcomer.
  if e.perfect_run >= e.shield_earn_days then
    e.recent_misses := 0;
  end if;

  v_tier := public.challenge_tier_day_at(p_season, e.qualified_days);
  if v_tier > e.current_tier_day then
    e.current_tier_day := v_tier;
    insert into public.challenge_events (user_id, season_id, kind, detail)
    values (p_user, p_season, 'tier_reached',
            jsonb_build_object('dayThreshold', v_tier, 'qualifiedDays', e.qualified_days));
  end if;
  if v_tier > e.highest_tier_day then
    e.highest_tier_day := v_tier;
  end if;

  select coalesce(max(t.day_threshold), 0) into v_final
    from public.challenge_tiers t where t.season_id = p_season;
  if v_final > 0 and e.qualified_days >= v_final then
    e.status := 'completed';
    e.completed_at := now();
    insert into public.challenge_events (user_id, season_id, kind, detail)
    values (p_user, p_season, 'completed',
            jsonb_build_object('qualifiedDays', e.qualified_days));
  end if;

  update public.challenge_enrollments
     set qualified_days = e.qualified_days,
         perfect_run = e.perfect_run,
         shields = e.shields,
         shields_earned = e.shields_earned,
         recent_misses = e.recent_misses,
         current_tier_day = e.current_tier_day,
         highest_tier_day = e.highest_tier_day,
         status = e.status,
         completed_at = e.completed_at,
         updated_at = now()
   where user_id = p_user and season_id = p_season;

  -- The ladder pays out. After the write-back — see the header.
  v_rewards := public.challenge_grant_tier_rewards(p_user, p_season, e.qualified_days);

  return jsonb_build_object(
    'ok', true,
    'qualified', true,
    'alreadyCounted', false,
    'qualifiedDays', e.qualified_days,
    'perfectRun', e.perfect_run,
    -- Re-read rather than reported from `e`: a shield effect on the rung just
    -- crossed has changed this row since the snapshot, and the number on the
    -- screen has to be the number in the table.
    'shields', (select x.shields from public.challenge_enrollments x
                 where x.user_id = p_user and x.season_id = p_season),
    'shieldEarned', v_earned,
    'tierDay', e.current_tier_day,
    'completed', e.status = 'completed',
    'rewards', v_rewards
  );
end;
$$;

-- ===========================================================================
-- 6. WHAT THE USER CAN ASK
-- ===========================================================================

/**
 * Everything this account has earned, newest first.
 *
 * A function rather than a plain select against `user_rewards`, because the
 * client wants the shelf in one shape and the table stores two — a cosmetic's
 * identity is in its slug, a consumable's is in its detail — and doing that
 * reshaping in four places on the client is how two screens end up disagreeing
 * about what somebody owns.
 */
create or replace function public.my_challenge_rewards()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'slug', r.slug,
      'kind', r.kind,
      'seasonId', r.season_id,
      'tierDay', r.tier_day,
      'detail', r.detail,
      'grantedAt', r.granted_at
    ) order by r.granted_at desc
  ), '[]'::jsonb)
  from public.user_rewards r
  where r.user_id = (select auth.uid())
    and r.revoked_at is null;
$$;

revoke all on function public.my_challenge_rewards() from public, anon;
grant execute on function public.my_challenge_rewards() to authenticated;

/**
 * Re-derives the caller's payouts from days they have already earned.
 *
 * Safe to expose, and worth exposing. It takes no arguments, reads
 * `qualified_days` off the caller's own enrolment, and every insert it can
 * cause is one the unique index would have refused a second time — so the worst
 * an attacker can do by calling it in a loop is grant themselves exactly what
 * the server already believes they are owed. It cannot manufacture a day, and a
 * day is the only thing worth manufacturing.
 *
 * What it buys is that a payout lost to a crash, a deploy, or a rung added to
 * the ladder after somebody passed it heals the next time they open the screen,
 * rather than sitting there as a badge that visibly did not arrive.
 *
 * Covers finished runs as well as live ones: the arrears of a run that ended on
 * a rung the operator only defined afterwards are still owed.
 */
create or replace function public.sync_my_challenge_rewards()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := (select auth.uid());
  e record;
  v_new jsonb := '[]'::jsonb;
begin
  if v_user is null then
    raise exception 'sign in first' using errcode = 'insufficient_privilege';
  end if;

  for e in
    select season_id, qualified_days
      from public.challenge_enrollments
     where user_id = v_user
  loop
    v_new := v_new || public.challenge_grant_tier_rewards(v_user, e.season_id, e.qualified_days);
  end loop;

  return v_new;
end;
$$;

revoke all on function public.sync_my_challenge_rewards() from public, anon;
grant execute on function public.sync_my_challenge_rewards() to authenticated;

-- ===========================================================================
-- 7. THE CONSOLE WRITES THE PAYOUT
-- ===========================================================================

/*
 * `admin_upsert_challenge_tier` gains the payout.
 *
 * Dropped and recreated rather than overloaded, for the reason 0059 gave when
 * it did the same to `admin_grant_premium`: a new trailing argument with a
 * default makes `rpc('admin_upsert_challenge_tier', ...)` ambiguous between the
 * two signatures, and the six-argument version has exactly one caller — the
 * season console — which this migration ships an update for.
 */
drop function if exists public.admin_upsert_challenge_tier(uuid, integer, text, text, text, text);

create or replace function public.admin_upsert_challenge_tier(
  p_season uuid,
  p_day integer,
  p_name text,
  p_kind text,
  p_title text,
  p_description text,
  p_rewards jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_effect jsonb;
begin
  if not public.is_admin() then
    raise exception 'not an administrator' using errcode = 'insufficient_privilege';
  end if;

  /*
   * Null means "leave the payout alone", not "clear it".
   *
   * The distinction is the whole reason this parameter defaults to null rather
   * than to an empty array. Every existing caller of this RPC predates the
   * column and sends six arguments; under an empty-array default, an operator
   * renaming a rung from the season console would silently wipe the badge, the
   * gradient and the Premium window attached to it, and nothing on the screen
   * would say so. An omitted argument must never be able to destroy data the
   * caller has never heard of.
   *
   * Clearing a payout deliberately is still possible — pass `[]`.
   */
  if p_rewards is not null and jsonb_typeof(p_rewards) <> 'array' then
    raise exception 'rewards must be an array' using errcode = 'invalid_parameter_value';
  end if;

  /*
   * Refused at the door rather than silently dropped at payout time. This is
   * the one place a human is looking at the effect they just typed, so it is
   * the only place the complaint is useful — `challenge_apply_reward` skipping
   * a malformed line is a safety net, not a substitute for being told.
   */
  for v_effect in select * from jsonb_array_elements(coalesce(p_rewards, '[]'::jsonb))
  loop
    if not public.challenge_reward_effect_ok(v_effect) then
      raise exception 'unrecognised reward effect: %', v_effect
        using errcode = 'invalid_parameter_value';
    end if;
  end loop;

  insert into public.admin_audit_log (actor, action, target_user, detail)
  values (auth.uid(), 'challenge_upsert_tier', null,
          jsonb_build_object('season', p_season, 'day', p_day, 'kind', p_kind,
                             'rewards', p_rewards));

  insert into public.challenge_tiers
    (season_id, day_threshold, name, reward_kind, reward_title, reward_description,
     rewards, sort_order)
  values (p_season, p_day, p_name, coalesce(p_kind, 'digital'), p_title, p_description,
          coalesce(p_rewards, '[]'::jsonb), p_day)
  on conflict (season_id, day_threshold) do update
    set name = excluded.name,
        reward_kind = excluded.reward_kind,
        reward_title = excluded.reward_title,
        reward_description = excluded.reward_description,
        -- See the header: an omitted payout preserves, it does not clear.
        rewards = coalesce(p_rewards, public.challenge_tiers.rewards),
        sort_order = excluded.sort_order;
end;
$$;

revoke all on function public.admin_upsert_challenge_tier(uuid, integer, text, text, text, text, jsonb)
  from public, anon;
grant execute on function public.admin_upsert_challenge_tier(uuid, integer, text, text, text, text, jsonb)
  to authenticated;

-- ===========================================================================
-- 8. THE REFERENCE LADDER, NOW WITH THINGS ON IT
-- ===========================================================================

/*
 * Backfills payouts onto the rungs the default seed already created.
 *
 * Matched on `day_threshold` and applied only where `rewards` is still empty,
 * so a season an operator has already curated is left alone — the same
 * gap-filling rule `admin_seed_challenge_defaults` follows.
 *
 * The premium windows are the part worth arguing about, and the argument is in
 * REWARDS_PROGRAM §1.5, which this migration amends: they are **bounded**, they
 * start at Blaze (ninety qualified days, which is a real commitment), and they
 * are the tool that converts the most engaged free users rather than a free
 * tier nobody agreed to. A user who has kept ninety consecutive days has
 * demonstrated exactly the behaviour a subscription is priced against, and a
 * week inside the product they have not seen is the cheapest possible
 * introduction to it.
 */
update public.challenge_tiers t
   set rewards = d.rewards
  from (values
    (  7, '[{"kind":"badge","slug":"spark"},{"kind":"theme","slug":"spark-dawn"}]'::jsonb),
    ( 30, '[{"kind":"badge","slug":"ember"},{"kind":"chain","slug":"ember-glow"},{"kind":"shield","count":1}]'::jsonb),
    ( 60, '[{"kind":"badge","slug":"flame"},{"kind":"theme","slug":"flame-dusk"}]'::jsonb),
    ( 90, '[{"kind":"badge","slug":"blaze"},{"kind":"frame","slug":"blaze-ring"},{"kind":"premium","days":7,"tier":"premium"}]'::jsonb),
    (120, '[{"kind":"badge","slug":"keystone"},{"kind":"chain","slug":"keystone-steel"}]'::jsonb),
    (180, '[{"kind":"badge","slug":"half-year"},{"kind":"frame","slug":"half-year-laurel"},{"kind":"premium","days":30,"tier":"premium"}]'::jsonb),
    (240, '[{"kind":"badge","slug":"forge"},{"kind":"theme","slug":"forge-gold"}]'::jsonb),
    (300, '[{"kind":"badge","slug":"summit"},{"kind":"chain","slug":"summit-aurora"}]'::jsonb),
    (365, '[{"kind":"badge","slug":"year-one"},{"kind":"frame","slug":"year-one-crown"},{"kind":"premium","days":90,"tier":"premium"}]'::jsonb)
  ) as d(day, rewards)
 where t.day_threshold = d.day
   and t.rewards = '[]'::jsonb;

/*
 * And the seed that creates future seasons learns the same ladder.
 *
 * Without this, the backfill above fixes the seasons that exist today and every
 * season seeded tomorrow arrives with an empty payout — which is the exact
 * failure 0055's header describes: a season that is enabled, inside its window,
 * and unable to give anybody anything, with nothing on either screen saying so.
 *
 * The prose changes too, and that is not cosmetic. The old titles promised a
 * finishers wall, a storage bump and a personalised film — none of which exist,
 * and two of which nobody has begun. A rung that describes a reward the engine
 * cannot pay is worse than a rung that describes a smaller one it can: the
 * first time somebody reaches day 300 and no film arrives, every other rung on
 * the ladder stops being believed. Each title now names exactly what
 * `rewards` on the same row actually grants.
 */
create or replace function public.challenge_seed_season_defaults(p_season uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_modules integer := 0;
  v_tiers integer := 0;
begin
  if not exists (select 1 from public.challenge_seasons where id = p_season) then
    return jsonb_build_object('ok', false, 'reason', 'no such season');
  end if;

  -- Gap-filling only. One curated module means the curation was deliberate.
  if not exists (select 1 from public.challenge_modules where season_id = p_season) then
    insert into public.challenge_modules (season_id, module_id, eligible, est_daily_seconds, sort_order)
    select p_season, d.module_id, true, d.seconds, d.ord
      from (values
        ('habits',   60, 1),
        ('tasks',    90, 2),
        ('journal', 180, 3),
        ('water',    20, 4),
        ('sleep',    30, 5),
        ('study',   300, 6),
        ('goals',    60, 7),
        ('notes',    60, 8)
      ) as d(module_id, seconds, ord)
    on conflict (season_id, module_id) do nothing;
    get diagnostics v_modules = row_count;
  end if;

  if not exists (select 1 from public.challenge_tiers where season_id = p_season) then
    insert into public.challenge_tiers
      (season_id, day_threshold, name, reward_kind, reward_title, rewards, sort_order)
    select p_season, d.day, d.name, d.kind, d.title, d.rewards, d.day
      from (values
        (  7, 'Spark',     'digital',  'A badge, and the Dawn gradient',
             '[{"kind":"badge","slug":"spark"},{"kind":"theme","slug":"spark-dawn"}]'::jsonb),
        ( 30, 'Ember',     'digital',  'A badge, the Ember chain, and a shield',
             '[{"kind":"badge","slug":"ember"},{"kind":"chain","slug":"ember-glow"},{"kind":"shield","count":1}]'::jsonb),
        ( 60, 'Flame',     'digital',  'A badge, and the Dusk gradient',
             '[{"kind":"badge","slug":"flame"},{"kind":"theme","slug":"flame-dusk"}]'::jsonb),
        ( 90, 'Blaze',     'digital',  'A badge, a profile frame, and a week of Premium',
             '[{"kind":"badge","slug":"blaze"},{"kind":"frame","slug":"blaze-ring"},{"kind":"premium","days":7,"tier":"premium"}]'::jsonb),
        (120, 'Keystone',  'digital',  'A badge, and the Steel chain',
             '[{"kind":"badge","slug":"keystone"},{"kind":"chain","slug":"keystone-steel"}]'::jsonb),
        (180, 'Half Year', 'digital',  'A badge, the laurel frame, and a month of Premium',
             '[{"kind":"badge","slug":"half-year"},{"kind":"frame","slug":"half-year-laurel"},{"kind":"premium","days":30,"tier":"premium"}]'::jsonb),
        (240, 'Forge',     'digital',  'A badge, and the Forge gradient',
             '[{"kind":"badge","slug":"forge"},{"kind":"theme","slug":"forge-gold"}]'::jsonb),
        (300, 'Summit',    'digital',  'A badge, and the Aurora chain',
             '[{"kind":"badge","slug":"summit"},{"kind":"chain","slug":"summit-aurora"}]'::jsonb),
        (365, 'Year One',  'physical', 'A badge, the crown frame, and three months of Premium',
             '[{"kind":"badge","slug":"year-one"},{"kind":"frame","slug":"year-one-crown"},{"kind":"premium","days":90,"tier":"premium"}]'::jsonb)
      ) as d(day, name, kind, title, rewards)
    on conflict (season_id, day_threshold) do nothing;
    get diagnostics v_tiers = row_count;
  end if;

  return jsonb_build_object('ok', true, 'modulesAdded', v_modules, 'tiersAdded', v_tiers);
end;
$$;

/*
 * The same honesty applied to the rungs already sitting in the database.
 *
 * Only where the title still reads exactly as 0055 seeded it — an operator who
 * has written their own copy for a season keeps it.
 */
update public.challenge_tiers t
   set reward_title = d.title
  from (values
    (  7, 'Badge and an exclusive gradient theme',        'A badge, and the Dawn gradient'),
    ( 30, 'Exclusive app icon, and your first shield',    'A badge, the Ember chain, and a shield'),
    ( 60, 'A shareable sixty-day stats card',             'A badge, and the Dusk gradient'),
    ( 90, 'Your name on the finishers wall, if you want it',
          'A badge, a profile frame, and a week of Premium'),
    (120, 'The gift box becomes visible, and named',      'A badge, and the Steel chain'),
    (180, 'Prestige badge, profile frame, storage bump',
          'A badge, the laurel frame, and a month of Premium'),
    (240, 'Custom chain colours and an animated badge',   'A badge, and the Forge gradient'),
    (300, 'A personalised film of your year so far',      'A badge, and the Aurora chain'),
    (365, 'The physical gift box, claimable',
          'A badge, the crown frame, and three months of Premium')
  ) as d(day, was, title)
 where t.day_threshold = d.day
   and t.reward_title = d.was;
