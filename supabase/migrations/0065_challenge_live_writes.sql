-- ---------------------------------------------------------------------------
-- 0065 — The live-write rule: the server has to have watched you do it.
--
-- ## What 0048 promised and did not enforce
--
-- 0048's header opens with the rule: "a day counts only when every module they
-- committed to got real activity, **while online**, and the server agreed."
-- Two of those three were enforced. The third was not.
--
-- `record_challenge_day` takes the client's own per-module write map and
-- accepts a submission for yesterday *or* today. So the actual behaviour was:
-- work through the whole checklist in airplane mode, close the app, connect
-- tomorrow morning, and the day is credited in full from a map the client
-- built by itself. Nothing anywhere asked whether the user had been online at
-- the moment any of it happened.
--
-- That is the loophole this file closes, and it is worth being precise about
-- which behaviour is the target, because it is a specific one: **finish the
-- day offline in a couple of minutes, then reconnect.** Under the old rule
-- that day counted. Under this one it never can, because the only thing that
-- can create the evidence is a round trip the offline device never made.
--
-- ## Why a table and not a flag
--
-- The instinct is to have the client report "I was online" alongside its write
-- map. That is worth exactly as much as a client reporting what day it is,
-- which 0048 already refuses to accept for the same reason. A claim about the
-- network, made by the party who benefits from the claim, over the network
-- that is allegedly absent, is not evidence.
--
-- So the server witnesses the write instead. `attest_challenge_write` is
-- called at the moment a row changes in a committed module, and the only thing
-- it records is `now()` — a value the caller cannot influence. A row in
-- `challenge_live_writes` therefore means precisely one thing, and it is the
-- thing the rule is about: *at this instant, on the server's clock, this user's
-- device reached us about this module.*
--
-- There is no backfill, no replay endpoint, and no parameter anywhere in this
-- file that lets a caller name a time. The absence is the enforcement, the same
-- way 0048's missing ad-callback RPC is.
--
-- ## Why the client must not queue
--
-- The server side above is only half of it. If the app buffered failed
-- attestations and flushed them on reconnect, every one of them would arrive
-- with a fresh `now()` and the loophole would be exactly as open as before —
-- the burst would just be better organised.
--
-- So `features/challenge/services/live-writes.ts` does not retry. An
-- attestation that fails is dead, the module is marked "not counted" in the
-- checklist immediately, and the user is told while they can still do something
-- about it. That file's header carries the same warning; the two have to stay
-- honest together, because either one alone reopens the hole.
--
-- `first_at`/`last_at` are recorded rather than a bare count so that the shape
-- of a day is auditable after the fact. A genuine session spreads its writes
-- across minutes; a replay lands them inside one second. Nothing in this
-- migration rejects on that basis — a fast honest user is real and must not
-- lose a day to a heuristic — but the evidence is on disk, so if bursting ever
-- shows up in the data the rule can be tightened from what actually happened
-- instead of from a guess.
--
-- ## Why this is a season switch and not a deploy
--
-- Turning the rule on globally the moment the migration applies would break
-- every enrolled user still running the previous build: their app does not call
-- `attest_challenge_write`, so every day would stop qualifying and the first
-- anybody would hear of it is a support ticket about a lost 80-day run.
--
-- `challenge_seasons.require_live_writes` defaults to **false**. The rule turns
-- on per season, once the client that implements it is actually in people's
-- hands. Same posture as every other knob in that table, and the same reason
-- `enabled` defaults to false: a season that ships itself on is a season that
-- ships itself on during a deploy nobody was watching.
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- 1. THE SWITCH
-- ===========================================================================

alter table public.challenge_seasons
  add column if not exists require_live_writes boolean not null default false;

comment on column public.challenge_seasons.require_live_writes is
  'When true, a module counts toward a day only if challenge_live_writes holds '
  'a server-stamped attestation for it. Off by default so the rule can be '
  'turned on after the client that implements it has shipped.';

-- ===========================================================================
-- 2. THE LEDGER OF WITNESSED WRITES
--
-- One row per (user, season, day, module) rather than one per write: the
-- question this table answers is "was this module worked on, live, today", and
-- a row per keystroke would be a table that grows without bound to answer a
-- question that only needs a count.
-- ===========================================================================

create table if not exists public.challenge_live_writes (
  user_id uuid not null references auth.users(id) on delete cascade,
  season_id uuid not null references public.challenge_seasons(id) on delete cascade,
  local_day date not null,
  module_id text not null,
  -- Both stamped from now(), never from anything the caller sends.
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  -- Counted so `min_writes` can be satisfied from witnessed writes alone.
  writes integer not null default 1,
  primary key (user_id, season_id, local_day, module_id)
);

alter table public.challenge_live_writes enable row level security;

-- Readable by its owner, so the checklist can show which modules the server has
-- actually seen. No insert, update or delete policy for anybody — same rule
-- every table in 0048 follows, and for the same reason: evidence a client can
-- write is not evidence.
drop policy if exists challenge_live_writes_read on public.challenge_live_writes;
create policy challenge_live_writes_read on public.challenge_live_writes
  for select using (user_id = auth.uid());

create index if not exists challenge_live_writes_day_idx
  on public.challenge_live_writes (user_id, season_id, local_day);

-- ===========================================================================
-- 3. THE ATTESTATION
-- ===========================================================================

/**
 * Records that the server heard from this user about this module, right now.
 *
 * Takes a module and nothing else. There is deliberately no day parameter, no
 * timestamp parameter and no count parameter: every one of those would be a
 * value the caller could choose, and the entire worth of this row is that it
 * contains no such value.
 *
 * Cheap by design — this is on the write path of every module in the app, so
 * it is one upsert with no joins beyond the contract check. The contract check
 * itself is what stops the table filling with modules the user never committed
 * to; an uncommitted module is refused rather than stored, because storing it
 * would mean this table grows with activity that can never affect a day.
 *
 * Returns the outcome rather than raising, for the same reason the reporter
 * never throws: a streak attestation failing must not surface as an error in
 * whatever the user was actually doing.
 */
create or replace function public.attest_challenge_write(p_module text)
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
  v_committed boolean;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = 'insufficient_privilege';
  end if;

  if p_module is null or length(p_module) = 0 or length(p_module) > 64 then
    return jsonb_build_object('ok', false, 'reason', 'bad module');
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

  -- The contract as it stands today. A module swapped out yesterday stops
  -- being attestable the moment it stops being owed.
  select exists (
    select 1 from public.challenge_enrollment_modules m
     where m.user_id = v_uid and m.season_id = e.season_id and m.role = 'required'
       and m.module_id = p_module
       and m.added_on <= v_today
       and (m.removed_on is null or m.removed_on > v_today)
  ) into v_committed;

  if not v_committed then
    return jsonb_build_object('ok', false, 'reason', 'not committed');
  end if;

  insert into public.challenge_live_writes
    (user_id, season_id, local_day, module_id)
  values (v_uid, e.season_id, v_today, p_module)
  on conflict (user_id, season_id, local_day, module_id) do update
    set last_at = now(),
        -- Capped so a runaway client cannot inflate a counter without bound.
        -- Nothing reads it above `min_writes`, so the ceiling costs nothing.
        writes = least(public.challenge_live_writes.writes + 1, 1000);

  return jsonb_build_object('ok', true, 'localDay', v_today, 'module', p_module);
end;
$$;

-- ===========================================================================
-- 4. RECORDING A DAY, FROM EVIDENCE THE SERVER OWNS
--
-- Replaces 0048's version. The only change is where `v_hit` comes from, and it
-- is the whole point of the file: under the new rule the client's map is not
-- consulted at all.
-- ===========================================================================

/**
 * Unchanged from 0048 except for the source of the hit set.
 *
 * `p_module_writes` is kept in the signature deliberately, even though a season
 * with `require_live_writes` ignores it. Dropping the parameter would change
 * the function's identity and break every already-installed client's call the
 * instant the migration applied — which is exactly the "everyone loses their
 * streak during a deploy" failure this file is otherwise built to avoid. It
 * stays as the authority for seasons that have not turned the rule on, and is
 * read for nothing else.
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

  if s.require_live_writes then
    -- Only what the server watched happen. Note this reads the day being
    -- claimed, so yesterday's submission is still judged on yesterday's
    -- attestations — a late flush of a day that was genuinely worked online
    -- still credits, and a day that was worked offline still cannot.
    select coalesce(array_agg(w.module_id), '{}'::text[]) into v_hit
      from public.challenge_live_writes w
     where w.user_id = v_uid and w.season_id = e.season_id
       and w.local_day = p_local_day
       and w.writes >= s.min_writes;
  else
    select coalesce(array_agg(k), '{}'::text[]) into v_hit
      from jsonb_each_text(coalesce(p_module_writes, '{}'::jsonb)) as t(k, v)
     where coalesce(nullif(t.v, '')::integer, 0) >= s.min_writes;
  end if;

  select coalesce(array_agg(x), '{}'::text[]) into v_outstanding
    from unnest(v_required) as x
   where not x = any (v_hit);

  if array_length(v_outstanding, 1) > 0 then
    return jsonb_build_object(
      'ok', true, 'qualified', false, 'localDay', p_local_day,
      'required', to_jsonb(v_required), 'outstanding', to_jsonb(v_outstanding),
      'liveRequired', s.require_live_writes
    );
  end if;

  return public.challenge_credit_day(
    v_uid, e.season_id, p_local_day, v_hit, p_active_seconds
  ) || jsonb_build_object('localDay', p_local_day, 'required', to_jsonb(v_required));
end;
$$;

-- ===========================================================================
-- 5. WHAT THE CHECKLIST NEEDS TO DRAW THE DIFFERENCE
--
-- The client keeps its own buffered write counts for instant feedback, and
-- under the live rule those counts no longer mean a module will count. The
-- checklist therefore has to show two different ticks — "done" and "done, and
-- the server saw it" — and this is where the second one comes from.
--
-- Without it the failure is silent and brutal: somebody works offline all
-- evening, watches every line tick green, and finds out at midnight that none
-- of it counted. A rule this strict is only defensible if the app is honest
-- about it in real time.
-- ===========================================================================

create or replace function public.challenge_live_today()
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

  return jsonb_build_object(
    'enrolled', true,
    'localDay', v_today,
    'liveRequired', s.require_live_writes,
    'minWrites', s.min_writes,
    'attested', coalesce((
      select jsonb_object_agg(w.module_id, w.writes)
        from public.challenge_live_writes w
       where w.user_id = v_uid and w.season_id = e.season_id
         and w.local_day = v_today
    ), '{}'::jsonb)
  );
end;
$$;

-- ===========================================================================
-- 7. THE SWITCH, REACHABLE
--
-- Three functions from 0055 redefined to carry `require_live_writes`. Without
-- these the column exists and nothing can read or set it: the join screen
-- cannot warn anybody the rule applies before they commit to a season under
-- it, and the operator's only way to turn it on — or, far more urgently, back
-- off — would be a hand-written UPDATE against production.
--
-- Copied and amended rather than patched in place, because 0055 has already
-- been applied by hand to real databases and editing an applied migration
-- changes nothing that is already running. Each one is otherwise byte-identical
-- to its 0055 version.
-- ===========================================================================

create or replace function public.challenge_season_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s public.challenge_seasons%rowtype;
  v_state text;
  v_enrolled integer;
  v_seats integer;
  v_modules jsonb;
  v_tiers jsonb;
begin
  -- Joinable now.
  select cs.* into s
    from public.challenge_seasons cs
   where cs.enabled and public.challenge_season_state(cs.id) in ('open', 'full', 'notReady')
   order by coalesce(cs.starts_at, cs.created_at)
   limit 1;

  -- Else the next one to start.
  if not found then
    select cs.* into s
      from public.challenge_seasons cs
     where cs.enabled and public.challenge_season_state(cs.id) = 'upcoming'
     order by cs.starts_at
     limit 1;
  end if;

  -- Else the one most recently finished, so "it ended on the 14th" survives the
  -- end date instead of collapsing into "there is nothing".
  if not found then
    select cs.* into s
      from public.challenge_seasons cs
     where cs.enabled and public.challenge_season_state(cs.id) = 'ended'
     order by cs.ends_at desc
     limit 1;
  end if;

  if not found then
    return jsonb_build_object('state', 'none');
  end if;

  v_state := public.challenge_season_state(s.id);

  if s.max_enrollments is not null then
    select count(*)::integer into v_enrolled
      from public.challenge_enrollments where season_id = s.id;
    v_seats := greatest(s.max_enrollments - v_enrolled, 0);
  end if;

  select coalesce(jsonb_agg(
           jsonb_build_object('moduleId', m.module_id, 'estDailySeconds', m.est_daily_seconds)
           order by m.sort_order, m.module_id
         ), '[]'::jsonb)
    into v_modules
    from public.challenge_modules m
   where m.season_id = s.id and m.eligible;

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'dayThreshold', t.day_threshold,
             'name', t.name,
             'rewardKind', t.reward_kind,
             'rewardTitle', t.reward_title,
             'rewardDescription', t.reward_description
           ) order by t.day_threshold
         ), '[]'::jsonb)
    into v_tiers
    from public.challenge_tiers t
   where t.season_id = s.id;

  return jsonb_build_object(
    'state', v_state,
    'seasonId', s.id,
    'name', s.name,
    'startsAt', s.starts_at,
    'endsAt', s.ends_at,
    'requiredModules', s.required_modules,
    'moduleLockDays', s.module_lock_days,
    'moduleSwapsAllowed', s.module_swaps_allowed,
    'requireLiveWrites', s.require_live_writes,
    'minWrites', s.min_writes,
    'shieldCap', s.shield_cap,
    'shieldEarnDays', s.shield_earn_days,
    'termsUrl', s.terms_url,
    'seatsLeft', v_seats,
    'modules', v_modules,
    'tiers', v_tiers
  );
end;
$$;

create or replace function public.admin_challenge_seasons()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows jsonb;
begin
  if not public.is_admin() then
    raise exception 'not an administrator' using errcode = 'insufficient_privilege';
  end if;

  select coalesce(jsonb_agg(row order by row -> 'createdAt' desc), '[]'::jsonb)
    into v_rows
    from (
      select jsonb_build_object(
        'id', s.id,
        'name', s.name,
        'enabled', s.enabled,
        'state', public.challenge_season_state(s.id),
        'startsAt', s.starts_at,
        'endsAt', s.ends_at,
        'createdAt', s.created_at,
        'maxEnrollments', s.max_enrollments,
        'dayGraceHours', s.day_grace_hours,
        'minActiveSeconds', s.min_active_seconds,
        'minWrites', s.min_writes,
        'requiredModules', s.required_modules,
        'moduleLockDays', s.module_lock_days,
        'moduleSwapsAllowed', s.module_swaps_allowed,
        'requireLiveWrites', s.require_live_writes,
        'shieldEarnDays', s.shield_earn_days,
        'shieldFloorDays', s.shield_floor_days,
        'shieldCap', s.shield_cap,
        'maxDemotionDays', s.max_demotion_days,
        'termsUrl', s.terms_url,
        'eligibleModules', (select count(*) from public.challenge_modules m
                             where m.season_id = s.id and m.eligible),
        'tierCount', (select count(*) from public.challenge_tiers t where t.season_id = s.id),
        'enrolledCount', (select count(*) from public.challenge_enrollments e
                           where e.season_id = s.id),
        'activeCount', (select count(*) from public.challenge_enrollments e
                         where e.season_id = s.id and e.status = 'active')
      ) as row
      from public.challenge_seasons s
    ) rows;

  return v_rows;
end;
$$;

create or replace function public.admin_update_challenge_season(
  p_season uuid,
  p_patch jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  j jsonb := coalesce(p_patch, '{}'::jsonb);
  s public.challenge_seasons%rowtype;
begin
  if not public.is_admin() then
    raise exception 'not an administrator' using errcode = 'insufficient_privilege';
  end if;

  select * into s from public.challenge_seasons where id = p_season;
  if not found then
    raise exception 'no such season';
  end if;

  -- `? key` asks whether the caller mentioned it at all, which is the question
  -- a patch turns on. `->>` alone cannot tell an absent key from an explicit
  -- null, and those mean opposite things here.
  update public.challenge_seasons set
    name = case when j ? 'name' then coalesce(nullif(j ->> 'name', ''), name) else name end,
    starts_at = case when j ? 'startsAt'
                     then nullif(j ->> 'startsAt', '')::timestamptz else starts_at end,
    ends_at = case when j ? 'endsAt'
                   then nullif(j ->> 'endsAt', '')::timestamptz else ends_at end,
    max_enrollments = case when j ? 'maxEnrollments'
                           then nullif(j ->> 'maxEnrollments', '')::integer
                           else max_enrollments end,
    day_grace_hours = coalesce(nullif(j ->> 'dayGraceHours', '')::integer, day_grace_hours),
    min_active_seconds = coalesce(nullif(j ->> 'minActiveSeconds', '')::integer, min_active_seconds),
    min_writes = coalesce(nullif(j ->> 'minWrites', '')::integer, min_writes),
    required_modules = coalesce(nullif(j ->> 'requiredModules', '')::integer, required_modules),
    module_lock_days = coalesce(nullif(j ->> 'moduleLockDays', '')::integer, module_lock_days),
    -- `? key` rather than coalesce, like `name`/`startsAt` above: a boolean
    -- read through coalesce cannot be turned *off*, because 'false' and an
    -- absent key both fall through to the existing value. This is the one
    -- setting an operator is most likely to need to switch back in a hurry.
    require_live_writes = case when j ? 'requireLiveWrites'
                               then coalesce((j ->> 'requireLiveWrites')::boolean,
                                             require_live_writes)
                               else require_live_writes end,
    module_swaps_allowed = coalesce(nullif(j ->> 'moduleSwapsAllowed', '')::integer,
                                    module_swaps_allowed),
    shield_earn_days = coalesce(nullif(j ->> 'shieldEarnDays', '')::integer, shield_earn_days),
    shield_floor_days = coalesce(nullif(j ->> 'shieldFloorDays', '')::integer, shield_floor_days),
    shield_cap = coalesce(nullif(j ->> 'shieldCap', '')::integer, shield_cap),
    max_demotion_days = coalesce(nullif(j ->> 'maxDemotionDays', '')::integer, max_demotion_days),
    terms_url = case when j ? 'termsUrl' then nullif(j ->> 'termsUrl', '') else terms_url end,
    updated_at = now()
  where id = p_season;

  insert into public.admin_audit_log (actor, action, target_user, detail)
  values (auth.uid(), 'challenge_season_patch', null,
          jsonb_build_object('season', p_season, 'patch', j));

  return jsonb_build_object('ok', true, 'state', public.challenge_season_state(p_season));
end;
$$;

-- ===========================================================================
-- 8. GRANTS
-- ===========================================================================

revoke all on function public.attest_challenge_write(text) from public, anon;
revoke all on function public.challenge_live_today() from public, anon;
grant execute on function public.attest_challenge_write(text) to authenticated;
grant execute on function public.challenge_live_today() to authenticated;
