-- ---------------------------------------------------------------------------
-- 0048 — The streak challenge: a daily contract, a ledger, and shields.
--
-- A user commits to keeping several modules alive every day. A day counts only
-- when *every* module they committed to got real activity, while online, and
-- the server agreed. Miss a day and a shield absorbs it; run out of shields and
-- progress falls back down a ladder of rungs. Rewards at each rung are digital
-- here — nothing in this file ships anything to anybody, and there is
-- deliberately no table that holds a postal address yet (see "What is not here").
--
-- ## Why the server owns every decision
--
-- Everything a client could lie about, it would eventually lie about: what day
-- it is, how long the app was open, which modules were touched, how long the
-- streak is. So the client's only job is to report evidence — a per-module
-- write map and a session length — and every judgement is made here:
--
--   * The day is derived from `now()` and the timezone frozen at enrolment,
--     never from the device clock, and a submission naming any day outside
--     yesterday-or-today is refused. That single rule makes clock manipulation
--     worthless.
--   * The contract is read from `challenge_enrollment_modules` *as it stood on
--     that day*, which is why those rows are closed rather than deleted. When
--     somebody asks in four months why day 200 did not count, the answer has to
--     be reconstructible from the contract on day 200, not the one they have
--     now.
--   * `challenge_days` has a composite primary key, so a day is credited
--     exactly once however many times the client calls. That, and not a
--     nonce or a rate limiter, is the whole anti-replay design.
--
-- Which is why **no table in this file has an insert, update or delete policy
-- for anybody**. Owner rows are readable by their owner and that is all. A
-- streak the client can `UPDATE` is a streak anyone can `UPDATE` with an anon
-- key and one `curl`, and no amount of care in the app would change that.
--
-- ## Why the counters are split
--
-- Four numbers instead of one, because they answer different questions and
-- collapsing them makes the mechanic impossible to explain to the person living
-- with it:
--
--   qualified_days — progress toward the next rung. The number on screen.
--   perfect_run    — consecutive days with no miss of ANY kind. Earns shields,
--                    and ages out the escalation counter.
--   shields        — the buffer, hard-capped. Spending one costs a day of
--                    calendar, never a day of progress.
--   recent_misses  — how deep the next demotion goes.
--
-- Note `qualified_days` is a count and not a calendar span: a shielded day is a
-- gap in the calendar but not a break in the chain, which is exactly the
-- intended feel. It also means the finish date moves rather than the progress.
--
-- ## Why the maths is split from the clock
--
-- `challenge_credit_day` and `challenge_settle_missed_day` take the day as an
-- argument and know nothing about the current time; the public entry points
-- work out what day it is and then call them. That is not decoration — it is
-- what lets the state machine be tested exhaustively (scripts/test-migrations.mjs)
-- without time travel, on the same database that runs it. Under the old
-- reset-to-zero design a miss was one comparison. It is now a state machine
-- that decides whether somebody keeps a year of progress, and the only honest
-- way to ship that is with every branch covered.
--
-- The internal pair is revoked from `authenticated` for the obvious reason: they
-- credit days without checking what day it is.
--
-- ## What is not here, on purpose
--
--   * No claims table, no addresses, no shipping. This migration is the engine
--     only. Physical rewards arrive with their own migration, their own consent
--     copy and their own deletion policy, and until then there is nothing here
--     worth stealing.
--   * No function that grants a shield or a day from an advertising callback.
--     There is no such RPC and there must never be one: a path from ad
--     impressions to a reward is incentivised traffic whatever the intermediate
--     steps are called, and a shield that can be farmed is not scarce enough to
--     motivate anybody. The absence is the enforcement.
--   * No audit table. `admin_audit_log` (0010) already exists and every admin
--     function below writes to it, so operator actions on a streak read in the
--     same timeline as operator actions on anything else.
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- 1. TABLES
--
-- All of them before any function: a LANGUAGE SQL body is parsed and validated
-- at CREATE time, so a helper defined above the table it reads aborts the whole
-- migration (see scripts/check-migrations.mjs).
-- ===========================================================================

-- --- the season: every knob, so nothing is a code constant -----------------
--
-- Editable by an admin without a release. The defaults below are the ones the
-- program is designed around, not arbitrary: 30 clean days per shield, 3 held,
-- and a 45-day cap on any single fall so that a miss at day 364 costs 45 days
-- rather than the 65 that the naive "drop to the previous rung" rule would take
-- from the person who has invested most.
create table if not exists public.challenge_seasons (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- Off by default. A season that ships itself on is a season that ships itself
  -- on during a deploy nobody was watching.
  enabled boolean not null default false,
  starts_at timestamptz,
  ends_at timestamptz,
  -- Caps ENTRY, never winners. Bounding the number of people who can start
  -- bounds the liability before anybody starts, without making completion a
  -- race between them — which is the difference between a conditional gift and
  -- a promotion with an element of chance in it.
  max_enrollments integer,
  -- Activity up to this many hours past local midnight still counts as
  -- yesterday. Ships at 0, which is the strict rule; it exists so the rule can
  -- be loosened later without a release.
  day_grace_hours integer not null default 0 check (day_grace_hours between 0 and 12),
  -- An anti-bot floor, not an effort test. Three real writes across three
  -- modules is far stronger evidence of a genuine session than a timer.
  min_active_seconds integer not null default 30 check (min_active_seconds >= 0),
  -- Per committed module, not per day.
  min_writes integer not null default 1 check (min_writes >= 1),
  required_modules integer not null default 3 check (required_modules >= 1),
  -- The picker is locked for this long after enrolment, or it becomes the
  -- exploit: swap out whichever module you forgot today.
  module_lock_days integer not null default 30 check (module_lock_days >= 0),
  module_swaps_allowed integer not null default 2 check (module_swaps_allowed >= 0),
  shield_earn_days integer not null default 30 check (shield_earn_days > 0),
  -- Perks reduce the earn interval; none of them may take it below this.
  shield_floor_days integer not null default 20 check (shield_floor_days > 0),
  shield_cap integer not null default 3 check (shield_cap >= 0),
  max_demotion_days integer not null default 45 check (max_demotion_days >= 0),
  eligible_regions text[],
  terms_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.challenge_seasons enable row level security;

-- Readable by everyone, including signed-out visitors, for the same reason
-- `module_flags` is: it describes the program, not a person.
drop policy if exists challenge_seasons_read on public.challenge_seasons;
create policy challenge_seasons_read on public.challenge_seasons
  for select using (true);

-- --- the ladder ------------------------------------------------------------
--
-- A table rather than a constant because an admin has to be able to rename,
-- reprice, re-cap and reorder rungs without an app-store round trip.
-- `reward_kind` exists from the first day even though every row this migration
-- expects is 'digital': the code that opens a claim keys off it, and adding the
-- column later would mean a migration that has to backfill a decision.
create table if not exists public.challenge_tiers (
  season_id uuid not null references public.challenge_seasons (id) on delete cascade,
  day_threshold integer not null check (day_threshold > 0),
  name text not null,
  reward_kind text not null default 'digital'
    check (reward_kind in ('digital', 'physical')),
  reward_title text,
  reward_description text,
  reward_image_url text,
  unit_cost_cents integer not null default 0 check (unit_cost_cents >= 0),
  sort_order integer not null default 0,
  primary key (season_id, day_threshold)
);

alter table public.challenge_tiers enable row level security;

drop policy if exists challenge_tiers_read on public.challenge_tiers;
create policy challenge_tiers_read on public.challenge_tiers
  for select using (true);

-- --- which modules may be committed to -------------------------------------
--
-- Not every module suits a daily promise. Budget has days with no transaction,
-- the gallery is naturally weekly, music is not a thing you *do*. Letting
-- somebody commit to those sets them up to fail for reasons that have nothing
-- to do with discipline, so eligibility is curated — and curated per season and
-- in data, so it can be corrected the moment the failure breakdown says it is
-- wrong.
--
-- `module_id` is untyped text, matching `module_flags` and `usage_daily`, so a
-- new module never needs DDL to become eligible.
create table if not exists public.challenge_modules (
  season_id uuid not null references public.challenge_seasons (id) on delete cascade,
  module_id text not null,
  eligible boolean not null default true,
  -- Quoted by the picker so somebody choosing Study + Sleep + Budget sees that
  -- it is a twenty-minute commitment before signing up for a year of it.
  est_daily_seconds integer not null default 60 check (est_daily_seconds >= 0),
  sort_order integer not null default 0,
  primary key (season_id, module_id)
);

alter table public.challenge_modules enable row level security;

drop policy if exists challenge_modules_read on public.challenge_modules;
create policy challenge_modules_read on public.challenge_modules
  for select using (true);

-- --- the run ---------------------------------------------------------------
--
-- One row per user per season. There is deliberately no 'broken' status: a run
-- does not end on a miss, it falls. The only exits are finishing the ladder and
-- being voided.
create table if not exists public.challenge_enrollments (
  user_id uuid not null references auth.users (id) on delete cascade,
  season_id uuid not null references public.challenge_seasons (id) on delete cascade,
  enrolled_at timestamptz not null default now(),
  enrolled_local_day date not null,
  -- The settler's watermark: every day up to and including this one has been
  -- accounted for. Initialised to the day before enrolment so the first full
  -- day is eligible to be settled.
  last_settled_day date not null,
  -- Frozen at enrolment. Without freezing it, a flight creates or destroys a
  -- day and timezone-hopping becomes an exploit.
  tz_offset_minutes integer not null check (tz_offset_minutes between -840 and 840),
  qualified_days integer not null default 0 check (qualified_days >= 0),
  perfect_run integer not null default 0 check (perfect_run >= 0),
  shields integer not null default 0 check (shields >= 0),
  shields_earned integer not null default 0,
  recent_misses integer not null default 0,
  current_tier_day integer not null default 0,
  -- Never decreases. Badges already unlocked are never taken back; only
  -- progress toward the NEXT rung resets. Clawing back an earned reward is how
  -- a lapsed user becomes a public complaint.
  highest_tier_day integer not null default 0,
  -- Resolved once, here, rather than read from the live plan on every call. A
  -- subscription lapsing mid-season must not silently change the rules
  -- underneath somebody who is two hundred days in.
  shield_earn_days integer not null check (shield_earn_days > 0),
  swaps_used integer not null default 0,
  plan_at_enrolment text,
  device_id text,
  status text not null default 'active'
    check (status in ('active', 'completed', 'void')),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, season_id)
);

-- One live run per account. Completed and voided rows are exempt, so a user can
-- finish one season and start the next.
create unique index if not exists challenge_enrollments_one_active
  on public.challenge_enrollments (user_id) where status = 'active';

create index if not exists challenge_enrollments_season_idx
  on public.challenge_enrollments (season_id, status);

alter table public.challenge_enrollments enable row level security;

-- Read your own, and nothing else. `(select auth.uid())` for 0017's InitPlan
-- reason. No write policy: see the header.
drop policy if exists challenge_enrollments_read_own on public.challenge_enrollments;
create policy challenge_enrollments_read_own on public.challenge_enrollments
  for select using (user_id = (select auth.uid()));

-- --- the contract ----------------------------------------------------------
--
-- Rows are closed with `removed_on`, never deleted, because the question "what
-- did this person owe on the 12th of March" has to stay answerable. `added_on`
-- is part of the key so a module dropped in one season can be picked up again
-- later without colliding with its own history.
create table if not exists public.challenge_enrollment_modules (
  user_id uuid not null references auth.users (id) on delete cascade,
  season_id uuid not null references public.challenge_seasons (id) on delete cascade,
  module_id text not null,
  -- 'required' is the contract. 'extra' is ambition: an extra module missing
  -- must never cost somebody the day.
  role text not null default 'required' check (role in ('required', 'extra')),
  added_on date not null,
  removed_on date,
  primary key (user_id, season_id, module_id, added_on)
);

create index if not exists challenge_enrollment_modules_active_idx
  on public.challenge_enrollment_modules (user_id, season_id, role);

alter table public.challenge_enrollment_modules enable row level security;

drop policy if exists challenge_enrollment_modules_read_own on public.challenge_enrollment_modules;
create policy challenge_enrollment_modules_read_own on public.challenge_enrollment_modules
  for select using (user_id = (select auth.uid()));

-- --- the ledger ------------------------------------------------------------
--
-- Append-only, one row per day, and it records failures as well as successes.
-- A ledger of only the good days cannot answer "why did I drop", cannot draw an
-- honest chain, and quietly invites the support reply "it must have been your
-- phone". `modules_hit` is stored rather than a bare boolean for the same
-- reason, and because it is the only source for the operator read-out that
-- matters most: which module is costing people the most days.
create table if not exists public.challenge_days (
  user_id uuid not null references auth.users (id) on delete cascade,
  season_id uuid not null references public.challenge_seasons (id) on delete cascade,
  local_day date not null,
  outcome text not null check (outcome in ('qualified', 'shielded', 'missed')),
  modules_hit text[] not null default '{}'::text[],
  active_seconds integer not null default 0,
  -- Server clock, always. The device's opinion of the time is evidence, not
  -- testimony.
  recorded_at timestamptz not null default now(),
  app_version text,
  platform text,
  device_id text,
  primary key (user_id, season_id, local_day)
);

create index if not exists challenge_days_outcome_idx
  on public.challenge_days (season_id, outcome);

alter table public.challenge_days enable row level security;

drop policy if exists challenge_days_read_own on public.challenge_days;
create policy challenge_days_read_own on public.challenge_days
  for select using (user_id = (select auth.uid()));

-- --- the readable history --------------------------------------------------
--
-- What the user's own timeline renders from, and what the demotion notification
-- quotes. Having it means a support conversation is a query rather than an
-- argument.
create table if not exists public.challenge_events (
  id bigserial primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  season_id uuid not null references public.challenge_seasons (id) on delete cascade,
  kind text not null check (kind in (
    'enrolled', 'tier_reached', 'shield_earned', 'shield_spent', 'demoted',
    'module_swapped', 'completed', 'admin_shield_granted', 'admin_days_restored'
  )),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists challenge_events_user_idx
  on public.challenge_events (user_id, created_at desc);

alter table public.challenge_events enable row level security;

drop policy if exists challenge_events_read_own on public.challenge_events;
create policy challenge_events_read_own on public.challenge_events
  for select using (user_id = (select auth.uid()));

-- ===========================================================================
-- 2. THE CLOCK, AND THE LADDER LOOKUP
-- ===========================================================================

/**
 * What calendar day it is for somebody whose offset was frozen at enrolment.
 *
 * `p_grace_hours` shifts the boundary later: with a grace of 3, anything
 * happening before 03:00 local still belongs to the previous day. Subtracting
 * rather than adding is the direction that makes a late-night entry count for
 * the day the user thinks they are still in.
 */
create or replace function public.challenge_local_day(
  p_at timestamptz,
  p_tz_offset_minutes integer,
  p_grace_hours integer
)
returns date
language sql
immutable
as $$
  select (
    (p_at at time zone 'UTC')
    + p_tz_offset_minutes * interval '1 minute'
    - p_grace_hours * interval '1 hour'
  )::date;
$$;

/** The highest rung reached at a given number of qualified days; 0 for none. */
create or replace function public.challenge_tier_day_at(p_season uuid, p_days integer)
returns integer
language sql
stable
as $$
  select coalesce(max(t.day_threshold), 0)
    from public.challenge_tiers t
   where t.season_id = p_season
     and t.day_threshold <= p_days;
$$;

-- ===========================================================================
-- 3. THE STATE MACHINE
--
-- Both functions take the day as an argument and never ask what time it is.
-- Everything about "is this a day the user may claim" happens in section 4.
-- ===========================================================================

/**
 * Credits one qualified day and advances every counter.
 *
 * Idempotent by construction: the insert is `on conflict do nothing`, and a
 * conflict returns early without touching a counter. Calling this twice for the
 * same day is not an error, it is a no-op — which is what lets the client retry
 * a failed flush without arithmetic consequences.
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

  return jsonb_build_object(
    'ok', true,
    'qualified', true,
    'alreadyCounted', false,
    'qualifiedDays', e.qualified_days,
    'perfectRun', e.perfect_run,
    'shields', e.shields,
    'shieldEarned', v_earned,
    'tierDay', e.current_tier_day,
    'completed', e.status = 'completed'
  );
end;
$$;

/**
 * Settles a day that ended without qualifying: spends a shield, or demotes.
 *
 * The demotion target is the kinder of two numbers — the previous rung, and
 * `max_demotion_days` back from where they are. Without the second, the penalty
 * is inverted: a miss on day 8 costs one day and a miss on day 364 costs 65,
 * so the people who have invested most are punished hardest at exactly the
 * moment quitting is likeliest.
 *
 * A second unshielded miss before the run recovers drops one rung further. It
 * is deliberately measured from the *current* progress, so each fall gets its
 * own cap rather than compounding into a cliff.
 */
create or replace function public.challenge_settle_missed_day(
  p_user uuid,
  p_season uuid,
  p_local_day date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  e public.challenge_enrollments%rowtype;
  s public.challenge_seasons%rowtype;
  v_outcome text;
  v_prev integer;
  v_floor integer;
  v_target integer;
  v_from integer;
begin
  select * into e
    from public.challenge_enrollments
   where user_id = p_user and season_id = p_season
     for update;
  if not found or e.status <> 'active' then
    return jsonb_build_object('ok', false, 'reason', 'no active run');
  end if;

  select * into s from public.challenge_seasons where id = p_season;

  v_outcome := case when e.shields > 0 then 'shielded' else 'missed' end;

  insert into public.challenge_days
    (user_id, season_id, local_day, outcome, modules_hit, active_seconds)
  values (p_user, p_season, p_local_day, v_outcome, '{}'::text[], 0)
  on conflict (user_id, season_id, local_day) do nothing;

  if not found then
    return jsonb_build_object('ok', true, 'alreadySettled', true);
  end if;

  -- A shield saves your progress, not your clean record.
  e.perfect_run := 0;
  v_from := e.qualified_days;

  if v_outcome = 'shielded' then
    e.shields := e.shields - 1;
    insert into public.challenge_events (user_id, season_id, kind, detail)
    values (p_user, p_season, 'shield_spent',
            jsonb_build_object('day', p_local_day, 'shieldsLeft', e.shields));
  else
    e.recent_misses := e.recent_misses + 1;

    v_floor := greatest(e.qualified_days - s.max_demotion_days, 0);
    select coalesce(max(t.day_threshold), 0) into v_prev
      from public.challenge_tiers t
     where t.season_id = p_season and t.day_threshold < e.qualified_days;

    if e.recent_misses > 1 then
      select coalesce(max(t.day_threshold), 0) into v_prev
        from public.challenge_tiers t
       where t.season_id = p_season and t.day_threshold < v_prev;
    end if;

    v_target := greatest(v_prev, v_floor);

    if v_target < e.qualified_days then
      e.qualified_days := v_target;
      e.current_tier_day := public.challenge_tier_day_at(p_season, e.qualified_days);
      insert into public.challenge_events (user_id, season_id, kind, detail)
      values (p_user, p_season, 'demoted', jsonb_build_object(
        'day', p_local_day,
        'fromDays', v_from,
        'toDays', e.qualified_days,
        'tierDay', e.current_tier_day,
        'recentMisses', e.recent_misses
      ));
    end if;
  end if;

  update public.challenge_enrollments
     set qualified_days = e.qualified_days,
         perfect_run = e.perfect_run,
         shields = e.shields,
         recent_misses = e.recent_misses,
         current_tier_day = e.current_tier_day,
         updated_at = now()
   where user_id = p_user and season_id = p_season;

  return jsonb_build_object(
    'ok', true,
    'outcome', v_outcome,
    'qualifiedDays', e.qualified_days,
    'shields', e.shields,
    'tierDay', e.current_tier_day,
    'demotedFrom', case when v_outcome = 'missed' then v_from else null end
  );
end;
$$;

-- ===========================================================================
-- 4. WHAT A CLIENT MAY ACTUALLY CALL
-- ===========================================================================

/**
 * Joins a season, freezing the timezone and resolving the shield interval.
 *
 * Required and extra modules are separate arguments rather than one list with a
 * flag, because the difference is the entire contract: every required module
 * must be used or the day is lost, and an extra one missing must never cost
 * anybody anything.
 *
 * Extras buy a faster shield interval — more effort buys more forgiveness,
 * never faster progress. Nobody can shorten the run; they can only make it more
 * survivable, and only by doing more work. The annual-plan reduction stacks
 * with it down to `shield_floor_days`.
 *
 * NOTE for whoever adds physical rewards: the plan-based reduction below is
 * safe only while there is nothing to win. Before a physical prize ships, the
 * same head start must be reachable without paying — by referral, or by having
 * finished a previous season — or a subscription becomes consideration toward a
 * prize, which is a different legal object entirely.
 */
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

  select p.plan_id into v_plan from public.profiles p where p.id = v_uid;
  if v_plan = 'plus_yearly' then
    v_bonus := v_bonus + 5;
    v_shields := 1;
  end if;

  v_days := greatest(s.shield_earn_days - v_bonus, s.shield_floor_days);

  insert into public.challenge_enrollments (
    user_id, season_id, enrolled_local_day, last_settled_day, tz_offset_minutes,
    shields, shield_earn_days, plan_at_enrolment, device_id
  ) values (
    v_uid, p_season, v_today, v_today - 1, p_tz_offset_minutes,
    least(v_shields, s.shield_cap), v_days, v_plan, p_device_id
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
    'shieldEarnDays', v_days
  ));

  return jsonb_build_object(
    'ok', true, 'localDay', v_today, 'shieldEarnDays', v_days,
    'shields', least(v_shields, s.shield_cap)
  );
end;
$$;

/**
 * The hot path. The client reports evidence; this decides.
 *
 * `p_module_writes` is a per-module map — `{"habits": 2, "water": 5}` — not one
 * count, because the contract is per module. A day where two of three were
 * touched writes nothing at all and comes back with the outstanding list, which
 * is what the checklist and the "one module away" reminder render from.
 *
 * The day is checked against the server's clock and the frozen offset before
 * anything else. A submission naming any other day is refused outright rather
 * than clamped: silently crediting a different day than the one asked for is
 * how a bug becomes a support case nobody can reconstruct.
 */
create or replace function public.record_challenge_day(
  p_local_day date,
  p_module_writes jsonb,
  p_active_seconds integer,
  p_device_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  e public.challenge_enrollments%rowtype;
  s public.challenge_seasons%rowtype;
  v_uid uuid := auth.uid();
  v_today date;
  v_required text[];
  v_hit text[];
  v_outstanding text[];
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = 'insufficient_privilege';
  end if;

  select * into e
    from public.challenge_enrollments
   where user_id = v_uid and status = 'active';
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no active run');
  end if;

  select * into s from public.challenge_seasons where id = e.season_id;
  if not s.enabled then
    return jsonb_build_object('ok', false, 'reason', 'season paused');
  end if;

  v_today := public.challenge_local_day(now(), e.tz_offset_minutes, s.day_grace_hours);
  if p_local_day is null or p_local_day > v_today or p_local_day < v_today - 1 then
    return jsonb_build_object('ok', false, 'reason', 'day out of window',
                              'serverDay', v_today);
  end if;

  if coalesce(p_active_seconds, 0) < s.min_active_seconds then
    return jsonb_build_object('ok', false, 'reason', 'session too short',
                              'qualified', false);
  end if;

  -- The contract as it stood on the day being claimed, not as it stands now.
  select coalesce(array_agg(m.module_id), '{}'::text[]) into v_required
    from public.challenge_enrollment_modules m
   where m.user_id = v_uid and m.season_id = e.season_id and m.role = 'required'
     and m.added_on <= p_local_day
     and (m.removed_on is null or m.removed_on > p_local_day);

  select coalesce(array_agg(k), '{}'::text[]) into v_hit
    from jsonb_each_text(coalesce(p_module_writes, '{}'::jsonb)) as t(k, v)
   where coalesce(nullif(t.v, '')::integer, 0) >= s.min_writes;

  select coalesce(array_agg(x), '{}'::text[]) into v_outstanding
    from unnest(v_required) as x
   where not x = any (v_hit);

  if array_length(v_outstanding, 1) > 0 then
    return jsonb_build_object(
      'ok', true, 'qualified', false, 'localDay', p_local_day,
      'required', to_jsonb(v_required), 'outstanding', to_jsonb(v_outstanding)
    );
  end if;

  return public.challenge_credit_day(
    v_uid, e.season_id, p_local_day, v_hit, p_active_seconds
  ) || jsonb_build_object('localDay', p_local_day, 'required', to_jsonb(v_required));
end;
$$;

/**
 * What the app needs to draw today's checklist: the server's idea of the date,
 * what is owed, and whether the day is already in the ledger.
 *
 * It deliberately does not know how much of today's work is done — that lives
 * in the client's buffer and is merged there for instant feedback. This is the
 * half that cannot be faked.
 */
create or replace function public.challenge_today()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  e public.challenge_enrollments%rowtype;
  s public.challenge_seasons%rowtype;
  v_uid uuid := auth.uid();
  v_today date;
  v_required text[];
  v_outcome text;
begin
  if v_uid is null then
    return jsonb_build_object('enrolled', false);
  end if;

  select * into e from public.challenge_enrollments
   where user_id = v_uid and status = 'active';
  if not found then
    return jsonb_build_object('enrolled', false);
  end if;

  select * into s from public.challenge_seasons where id = e.season_id;
  v_today := public.challenge_local_day(now(), e.tz_offset_minutes, s.day_grace_hours);

  select coalesce(array_agg(m.module_id), '{}'::text[]) into v_required
    from public.challenge_enrollment_modules m
   where m.user_id = v_uid and m.season_id = e.season_id and m.role = 'required'
     and m.added_on <= v_today
     and (m.removed_on is null or m.removed_on > v_today);

  select d.outcome into v_outcome from public.challenge_days d
   where d.user_id = v_uid and d.season_id = e.season_id and d.local_day = v_today;

  return jsonb_build_object(
    'enrolled', true,
    'seasonId', e.season_id,
    'localDay', v_today,
    'required', to_jsonb(v_required),
    'todayOutcome', v_outcome,
    'qualifiedDays', e.qualified_days,
    'perfectRun', e.perfect_run,
    'shields', e.shields,
    'shieldEarnDays', e.shield_earn_days,
    'tierDay', e.current_tier_day,
    'minWrites', s.min_writes,
    'minActiveSeconds', s.min_active_seconds,
    -- The swap rules, so the picker can state them rather than letting somebody
    -- discover them by being refused. `swap_challenge_module` enforces both
    -- regardless; these exist only so the screen can be honest first.
    'swapsLeft', greatest(s.module_swaps_allowed - e.swaps_used, 0),
    'swapsUnlockDay', e.enrolled_local_day + s.module_lock_days
  );
end;
$$;

/**
 * Trades one required module for another, from tomorrow.
 *
 * Never backdated, which is the whole point: a swap that could take effect
 * today would rescue a day already lost, and the picker would become the way
 * out of every missed evening.
 */
create or replace function public.swap_challenge_module(p_out text, p_in text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  e public.challenge_enrollments%rowtype;
  s public.challenge_seasons%rowtype;
  v_uid uuid := auth.uid();
  v_today date;
  v_from date;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = 'insufficient_privilege';
  end if;

  select * into e from public.challenge_enrollments
   where user_id = v_uid and status = 'active'
     for update;
  if not found then
    raise exception 'no active run';
  end if;

  select * into s from public.challenge_seasons where id = e.season_id;
  v_today := public.challenge_local_day(now(), e.tz_offset_minutes, s.day_grace_hours);

  if v_today < e.enrolled_local_day + s.module_lock_days then
    raise exception 'modules are locked for the first % days', s.module_lock_days;
  end if;
  if e.swaps_used >= s.module_swaps_allowed then
    raise exception 'no swaps left';
  end if;
  if p_out = p_in then
    raise exception 'nothing to swap';
  end if;
  if not exists (select 1 from public.challenge_modules
                  where season_id = e.season_id and module_id = p_in and eligible) then
    raise exception 'module % may not be committed to this season', p_in;
  end if;

  v_from := v_today + 1;

  update public.challenge_enrollment_modules
     set removed_on = v_from
   where user_id = v_uid and season_id = e.season_id and module_id = p_out
     and role = 'required' and removed_on is null;
  if not found then
    raise exception 'module % is not one of yours', p_out;
  end if;

  insert into public.challenge_enrollment_modules
    (user_id, season_id, module_id, role, added_on)
  values (v_uid, e.season_id, p_in, 'required', v_from)
  on conflict (user_id, season_id, module_id, added_on) do nothing;

  update public.challenge_enrollments
     set swaps_used = e.swaps_used + 1, updated_at = now()
   where user_id = v_uid and season_id = e.season_id;

  insert into public.challenge_events (user_id, season_id, kind, detail)
  values (v_uid, e.season_id, 'module_swapped', jsonb_build_object(
    'out', p_out, 'in', p_in, 'effectiveFrom', v_from,
    'swapsLeft', s.module_swaps_allowed - e.swaps_used - 1
  ));

  return jsonb_build_object('ok', true, 'effectiveFrom', v_from);
end;
$$;

-- ===========================================================================
-- 5. THE NIGHTLY SETTLER
--
-- Run from cron or a scheduled edge function. It exists because a lapsed run
-- must not keep telling the user it is fine until they next open the app — and
-- because a dashboard that counts everybody who has not yet been told they
-- lapsed as "active" is a dashboard that lies in the direction you want to
-- believe.
-- ===========================================================================

create or replace function public.settle_stale_runs()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_today date;
  d date;
  v_settled integer := 0;
begin
  for r in
    select e.user_id, e.season_id, e.tz_offset_minutes, e.last_settled_day,
           s.day_grace_hours
      from public.challenge_enrollments e
      join public.challenge_seasons s on s.id = e.season_id
     where e.status = 'active'
  loop
    v_today := public.challenge_local_day(now(), r.tz_offset_minutes, r.day_grace_hours);
    d := r.last_settled_day + 1;

    -- Strictly before today: the current day is still winnable.
    while d < v_today loop
      if not exists (
        select 1 from public.challenge_days
         where user_id = r.user_id and season_id = r.season_id and local_day = d
      ) then
        perform public.challenge_settle_missed_day(r.user_id, r.season_id, d);
        v_settled := v_settled + 1;
      end if;

      update public.challenge_enrollments
         set last_settled_day = d
       where user_id = r.user_id and season_id = r.season_id;

      d := d + 1;
    end loop;
  end loop;

  return v_settled;
end;
$$;

-- ===========================================================================
-- 6. OPERATOR ENTRY POINTS
--
-- Same shape as every other admin function in this schema: `is_admin()` first,
-- audit row second, effect third. The console is a view over these and never a
-- second permission system.
-- ===========================================================================

/** Creates or updates a season. Numeric knobs travel in `p_settings` so adding
 *  one never changes this signature and breaks every caller. */
create or replace function public.admin_upsert_challenge_season(
  p_id uuid,
  p_name text,
  p_enabled boolean,
  p_settings jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  j jsonb := coalesce(p_settings, '{}'::jsonb);
begin
  if not public.is_admin() then
    raise exception 'not an administrator' using errcode = 'insufficient_privilege';
  end if;

  insert into public.admin_audit_log (actor, action, target_user, detail)
  values (auth.uid(), 'challenge_upsert_season', null,
          jsonb_build_object('id', p_id, 'name', p_name, 'enabled', p_enabled, 'settings', j));

  insert into public.challenge_seasons as cs (
    id, name, enabled, starts_at, ends_at, max_enrollments, day_grace_hours,
    min_active_seconds, min_writes, required_modules, module_lock_days,
    module_swaps_allowed, shield_earn_days, shield_floor_days, shield_cap,
    max_demotion_days, terms_url
  ) values (
    coalesce(p_id, gen_random_uuid()), p_name, coalesce(p_enabled, false),
    nullif(j ->> 'startsAt', '')::timestamptz,
    nullif(j ->> 'endsAt', '')::timestamptz,
    nullif(j ->> 'maxEnrollments', '')::integer,
    coalesce(nullif(j ->> 'dayGraceHours', '')::integer, 0),
    coalesce(nullif(j ->> 'minActiveSeconds', '')::integer, 30),
    coalesce(nullif(j ->> 'minWrites', '')::integer, 1),
    coalesce(nullif(j ->> 'requiredModules', '')::integer, 3),
    coalesce(nullif(j ->> 'moduleLockDays', '')::integer, 30),
    coalesce(nullif(j ->> 'moduleSwapsAllowed', '')::integer, 2),
    coalesce(nullif(j ->> 'shieldEarnDays', '')::integer, 30),
    coalesce(nullif(j ->> 'shieldFloorDays', '')::integer, 20),
    coalesce(nullif(j ->> 'shieldCap', '')::integer, 3),
    coalesce(nullif(j ->> 'maxDemotionDays', '')::integer, 45),
    nullif(j ->> 'termsUrl', '')
  )
  on conflict (id) do update
    set name = excluded.name,
        enabled = excluded.enabled,
        starts_at = excluded.starts_at,
        ends_at = excluded.ends_at,
        max_enrollments = excluded.max_enrollments,
        day_grace_hours = excluded.day_grace_hours,
        min_active_seconds = excluded.min_active_seconds,
        min_writes = excluded.min_writes,
        required_modules = excluded.required_modules,
        module_lock_days = excluded.module_lock_days,
        module_swaps_allowed = excluded.module_swaps_allowed,
        shield_earn_days = excluded.shield_earn_days,
        shield_floor_days = excluded.shield_floor_days,
        shield_cap = excluded.shield_cap,
        max_demotion_days = excluded.max_demotion_days,
        terms_url = excluded.terms_url,
        updated_at = now()
  returning cs.id into v_id;

  return v_id;
end;
$$;

/** Creates or updates one rung. */
create or replace function public.admin_upsert_challenge_tier(
  p_season uuid,
  p_day integer,
  p_name text,
  p_kind text,
  p_title text,
  p_description text
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

  insert into public.admin_audit_log (actor, action, target_user, detail)
  values (auth.uid(), 'challenge_upsert_tier', null,
          jsonb_build_object('season', p_season, 'day', p_day, 'kind', p_kind));

  insert into public.challenge_tiers
    (season_id, day_threshold, name, reward_kind, reward_title, reward_description, sort_order)
  values (p_season, p_day, p_name, coalesce(p_kind, 'digital'), p_title, p_description, p_day)
  on conflict (season_id, day_threshold) do update
    set name = excluded.name,
        reward_kind = excluded.reward_kind,
        reward_title = excluded.reward_title,
        reward_description = excluded.reward_description,
        sort_order = excluded.sort_order;
end;
$$;

/** Turns a module's eligibility on or off for a season. */
create or replace function public.admin_set_challenge_module(
  p_season uuid,
  p_module text,
  p_eligible boolean,
  p_est_daily_seconds integer
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

  insert into public.admin_audit_log (actor, action, target_user, detail)
  values (auth.uid(), 'challenge_set_module', null,
          jsonb_build_object('season', p_season, 'module', p_module, 'eligible', p_eligible));

  insert into public.challenge_modules (season_id, module_id, eligible, est_daily_seconds)
  values (p_season, p_module, coalesce(p_eligible, true), coalesce(p_est_daily_seconds, 60))
  on conflict (season_id, module_id) do update
    set eligible = excluded.eligible,
        est_daily_seconds = excluded.est_daily_seconds;
end;
$$;

/**
 * Hands somebody a shield, for the cases the mechanic cannot see: a hospital
 * stay, a bereavement, an outage that was ours. Reason is mandatory and the
 * cap still applies — the point is a human override, not a private economy.
 */
create or replace function public.admin_grant_challenge_shield(
  p_user uuid,
  p_count integer,
  p_reason text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  e public.challenge_enrollments%rowtype;
  s public.challenge_seasons%rowtype;
  v_new integer;
begin
  if not public.is_admin() then
    raise exception 'not an administrator' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'a reason is required';
  end if;

  select * into e from public.challenge_enrollments
   where user_id = p_user and status = 'active' for update;
  if not found then
    raise exception 'no active run';
  end if;
  select * into s from public.challenge_seasons where id = e.season_id;

  v_new := least(e.shields + greatest(coalesce(p_count, 1), 0), s.shield_cap);

  insert into public.admin_audit_log (actor, action, target_user, detail)
  values (auth.uid(), 'challenge_grant_shield', p_user,
          jsonb_build_object('count', p_count, 'reason', p_reason, 'shields', v_new));

  update public.challenge_enrollments
     set shields = v_new, updated_at = now()
   where user_id = p_user and season_id = e.season_id;

  insert into public.challenge_events (user_id, season_id, kind, detail)
  values (p_user, e.season_id, 'admin_shield_granted',
          jsonb_build_object('shields', v_new, 'reason', p_reason));

  return v_new;
end;
$$;

/** Puts days back after a fault that was ours. Same rules: reasoned, audited. */
create or replace function public.admin_restore_challenge_days(
  p_user uuid,
  p_days integer,
  p_reason text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  e public.challenge_enrollments%rowtype;
  v_new integer;
begin
  if not public.is_admin() then
    raise exception 'not an administrator' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'a reason is required';
  end if;

  select * into e from public.challenge_enrollments
   where user_id = p_user and status = 'active' for update;
  if not found then
    raise exception 'no active run';
  end if;

  v_new := greatest(e.qualified_days + coalesce(p_days, 0), 0);

  insert into public.admin_audit_log (actor, action, target_user, detail)
  values (auth.uid(), 'challenge_restore_days', p_user,
          jsonb_build_object('days', p_days, 'reason', p_reason, 'qualifiedDays', v_new));

  update public.challenge_enrollments
     set qualified_days = v_new,
         current_tier_day = public.challenge_tier_day_at(e.season_id, v_new),
         highest_tier_day = greatest(
           e.highest_tier_day, public.challenge_tier_day_at(e.season_id, v_new)
         ),
         updated_at = now()
   where user_id = p_user and season_id = e.season_id;

  insert into public.challenge_events (user_id, season_id, kind, detail)
  values (p_user, e.season_id, 'admin_days_restored',
          jsonb_build_object('qualifiedDays', v_new, 'reason', p_reason));

  return v_new;
end;
$$;

-- ===========================================================================
-- 7. GRANTS
--
-- The state machine is not callable by a client: `challenge_credit_day` and
-- `challenge_settle_missed_day` credit and settle days without ever asking what
-- day it is, which is exactly right for the entry points that have already
-- checked and exactly wrong for anybody else.
-- ===========================================================================

revoke all on function public.challenge_credit_day(uuid, uuid, date, text[], integer)
  from public, anon, authenticated;
revoke all on function public.challenge_settle_missed_day(uuid, uuid, date)
  from public, anon, authenticated;
revoke all on function public.settle_stale_runs() from public, anon, authenticated;
grant execute on function public.settle_stale_runs() to service_role;

revoke all on function public.enroll_in_challenge(uuid, integer, text[], text[], text)
  from public, anon;
revoke all on function public.record_challenge_day(date, jsonb, integer, text) from public, anon;
revoke all on function public.challenge_today() from public, anon;
revoke all on function public.swap_challenge_module(text, text) from public, anon;
grant execute on function public.enroll_in_challenge(uuid, integer, text[], text[], text)
  to authenticated;
grant execute on function public.record_challenge_day(date, jsonb, integer, text) to authenticated;
grant execute on function public.challenge_today() to authenticated;
grant execute on function public.swap_challenge_module(text, text) to authenticated;

revoke all on function public.admin_upsert_challenge_season(uuid, text, boolean, jsonb)
  from public, anon;
revoke all on function public.admin_upsert_challenge_tier(uuid, integer, text, text, text, text)
  from public, anon;
revoke all on function public.admin_set_challenge_module(uuid, text, boolean, integer)
  from public, anon;
revoke all on function public.admin_grant_challenge_shield(uuid, integer, text) from public, anon;
revoke all on function public.admin_restore_challenge_days(uuid, integer, text) from public, anon;
grant execute on function public.admin_upsert_challenge_season(uuid, text, boolean, jsonb)
  to authenticated;
grant execute on function public.admin_upsert_challenge_tier(uuid, integer, text, text, text, text)
  to authenticated;
grant execute on function public.admin_set_challenge_module(uuid, text, boolean, integer)
  to authenticated;
grant execute on function public.admin_grant_challenge_shield(uuid, integer, text) to authenticated;
grant execute on function public.admin_restore_challenge_days(uuid, integer, text) to authenticated;

-- Reads go through RLS, which is what actually restricts the rows.
grant select on public.challenge_seasons to anon, authenticated;
grant select on public.challenge_tiers to anon, authenticated;
grant select on public.challenge_modules to anon, authenticated;
grant select on public.challenge_enrollments to authenticated;
grant select on public.challenge_enrollment_modules to authenticated;
grant select on public.challenge_days to authenticated;
grant select on public.challenge_events to authenticated;
