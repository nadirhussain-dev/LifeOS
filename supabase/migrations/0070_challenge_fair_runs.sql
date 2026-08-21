-- ---------------------------------------------------------------------------
-- 0070 — A run gets its own calendar, so joining late costs nothing.
--
-- The ladder is measured in qualified days (7, 30, 60 … 365) and the season was
-- measured in dates. Those two only agree for somebody who joins on the opening
-- day. Everybody else is quietly playing a shorter game:
--
--   Season runs Jan → Dec. You join in July. The most days you can possibly
--   accumulate is about 180 — so Forge (240), Summit (300) and Year One (365,
--   the physical gift) are unreachable the moment you enrol. Nothing said so.
--   The ladder rendered all nine rungs and the screen cheerfully offered
--   "60 days to Forge" for a rung that could not be reached at any rate of
--   effort. 0069 then closed the run out at whatever it had, which is honest
--   reporting of an unfair game.
--
-- The fix is not to shrink the ladder for late joiners — a rung has to mean the
-- same thing for everybody or the cosmetics attached to it are worth nothing
-- (REWARDS_STRATEGY is explicit that they only carry value where other people
-- see them, and "Summit in 60 days" next to "Summit in 300" is corrosive). It is
-- to give each run its own window of the same length.
--
-- ## What a season now is
--
-- `starts_at`/`ends_at` become the **enrolment window** — when you may join —
-- and `duration_days` is how long a run lasts once you have. `enroll_in_challenge`
-- already refused a season outside its dates, and that behaviour is unchanged
-- and now says exactly the right thing.
--
-- The two are exclusive: a duration makes `ends_at` the join deadline, and a
-- null duration keeps `ends_at` as the finish line for everybody at once. That is not a compatibility shim to delete later —
-- a fixed-date event (a Ramadan season, a January cohort) is a legitimate thing
-- to run, and it should stay expressible. What it must no longer be is the
-- accidental default.
--
-- ## Why the window is stamped on the row
--
-- `run_ends_on` is computed once, at enrolment, and stored — rather than derived
-- from `duration_days` on every read. Same reason `tz_offset_minutes` and
-- `shield_earn_days` are frozen there: an operator lengthening a season for the
-- next cohort must not silently move the finish line under somebody who is two
-- hundred days in, in either direction.
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- 1. SCHEMA
-- ===========================================================================

alter table public.challenge_seasons
  add column if not exists duration_days integer;

alter table public.challenge_seasons
  drop constraint if exists challenge_seasons_duration_check;

-- A run shorter than the first rung is a run nobody can get anything out of.
alter table public.challenge_seasons
  add constraint challenge_seasons_duration_check
  check (duration_days is null or duration_days >= 7);

-- The last local day this run may earn. Null means "when the season ends",
-- which is the pre-0070 behaviour and stays available.
alter table public.challenge_enrollments
  add column if not exists run_ends_on date;

/*
 * Existing runs keep the finish line they already had.
 *
 * Backfilled from the season's end date rather than from `duration_days`,
 * because that is the deal those people actually enrolled under. Somebody two
 * months into a calendar season does not get silently handed a year.
 */
update public.challenge_enrollments e
   set run_ends_on = public.challenge_local_day(s.ends_at, e.tz_offset_minutes,
                                                s.day_grace_hours)
  from public.challenge_seasons s
 where s.id = e.season_id
   and e.run_ends_on is null
   and s.ends_at is not null;

-- ===========================================================================
-- 2. THE RUN'S OWN WINDOW, RESOLVED ONCE
-- ===========================================================================

/**
 * The last day a run enrolled today may earn, or null for an open-ended one.
 *
 * `duration_days` counts the day you join as day one, so a 365-day run ends on
 * `enrolled + 364`. Off-by-one here is the difference between a ladder whose
 * top rung is reachable and one that is out by a day, which is the least
 * forgivable possible way to miss it.
 *
 * The two configurations are exclusive, deliberately:
 *
 *   duration set  — a rolling season. `ends_at` is the last day you may JOIN,
 *                   and every run gets its full duration from the day it
 *                   starts. This is the fair one.
 *   duration null — a fixed-date season. `ends_at` is the finish line and
 *                   everybody stops together, which is what a Ramadan season
 *                   or a January cohort actually wants.
 *
 * Taking the earlier of the two was the first thing tried here and it is wrong:
 * it re-creates the whole bug. A July joiner in a Jan–Dec season with a 365-day
 * duration would be capped at December again, and the top rungs would go back
 * to being unreachable — the fair-looking `least()` quietly undoing the fix.
 */
create or replace function public.challenge_run_end_day(
  p_season uuid,
  p_enrolled_local_day date,
  p_tz_offset_minutes integer
)
returns date
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s public.challenge_seasons%rowtype;
begin
  select * into s from public.challenge_seasons where id = p_season;
  if not found then return null; end if;

  if s.duration_days is not null then
    return p_enrolled_local_day + (s.duration_days - 1);
  end if;

  return case when s.ends_at is null then null
              else public.challenge_local_day(s.ends_at, p_tz_offset_minutes,
                                              s.day_grace_hours) end;
end;
$$;

-- ===========================================================================
-- 3. ENROLMENT STAMPS THE WINDOW
-- ===========================================================================

/**
 * 0048's function with one addition: the run's own finish line.
 *
 * Everything else — the seat cap, the device rule, the module validation, the
 * plan bonus — is unchanged and deliberately re-stated rather than patched, so
 * the whole entry path can be read in one place.
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

  select p.plan_id into v_plan from public.profiles p where p.id = v_uid;
  if v_plan = 'plus_yearly' then
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

-- ===========================================================================
-- 4. CREDITING AND FINISHING FOLLOW THE RUN, NOT THE SEASON
-- ===========================================================================

/**
 * 0069's window guard, moved onto the run's own dates.
 *
 * The lower bound stays the season's opening — a day before the season existed
 * is not a day anybody worked inside it — but the upper bound is now
 * `run_ends_on`, so a July joiner's 365th day counts even though the calendar
 * season closed in December.
 *
 * Still checked against the *claimed* day rather than `now()`, so a last day
 * flushed the following morning is credited: it was earned fairly.
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
  v_opens date;
  v_closes date;
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

  v_opens := case when s.starts_at is null then null
                  else public.challenge_local_day(s.starts_at, e.tz_offset_minutes,
                                                  s.day_grace_hours) end;
  v_closes := e.run_ends_on;

  if (v_opens is not null and p_local_day < v_opens)
     or (v_closes is not null and p_local_day > v_closes) then
    return jsonb_build_object('ok', false, 'reason', 'season closed',
                              'localDay', p_local_day);
  end if;

  if coalesce(p_active_seconds, 0) < s.min_active_seconds then
    return jsonb_build_object('ok', false, 'reason', 'session too short',
                              'qualified', false);
  end if;

  select coalesce(array_agg(m.module_id), '{}'::text[]) into v_required
    from public.challenge_enrollment_modules m
   where m.user_id = v_uid and m.season_id = e.season_id and m.role = 'required'
     and m.added_on <= p_local_day
     and (m.removed_on is null or m.removed_on > p_local_day);

  if s.require_live_writes then
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

/**
 * 0069's sweep, keyed on each run's own finish line.
 *
 * Named for the season still, because that is what the edge function calls and
 * what it means to the operator — but the row it acts on is the enrollment, and
 * two people in the same season now finish on different days. A run with no
 * `run_ends_on` at all (an open-ended season) is never finished by the clock,
 * which is correct: nothing has said when it should stop.
 */
create or replace function public.finalize_ended_seasons()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  d date;
  v_last date;
  v_finished integer := 0;
begin
  for r in
    select e.user_id, e.season_id, e.tz_offset_minutes, e.last_settled_day,
           e.run_ends_on, s.day_grace_hours
      from public.challenge_enrollments e
      join public.challenge_seasons s on s.id = e.season_id
     where e.status = 'active'
       and e.run_ends_on is not null
       and public.challenge_local_day(now(), e.tz_offset_minutes, s.day_grace_hours)
           > e.run_ends_on
  loop
    -- Settle first, then finish: closing the run before its last days are
    -- judged would forgive whatever was missed at the end — the one stretch
    -- where somebody who has already given up stops logging.
    d := r.last_settled_day + 1;
    v_last := r.last_settled_day;
    while d <= r.run_ends_on loop
      if not exists (
        select 1 from public.challenge_days
         where user_id = r.user_id and season_id = r.season_id and local_day = d
      ) then
        perform public.challenge_settle_missed_day(r.user_id, r.season_id, d);
      end if;
      v_last := d;
      d := d + 1;
    end loop;

    update public.challenge_enrollments
       set status = 'ended',
           finished_at = now(),
           last_settled_day = greatest(last_settled_day, v_last),
           updated_at = now()
     where user_id = r.user_id and season_id = r.season_id and status = 'active';

    insert into public.challenge_events (user_id, season_id, kind, detail)
    values (r.user_id, r.season_id, 'season_ended',
            jsonb_build_object('qualifiedDays',
              (select qualified_days from public.challenge_enrollments
                where user_id = r.user_id and season_id = r.season_id)));

    v_finished := v_finished + 1;
  end loop;

  return v_finished;
end;
$$;

-- ===========================================================================
-- 5. THE APP CAN SEE THE FINISH LINE
-- ===========================================================================

/**
 * 0069's shape plus `runEndsOn` and `daysLeft`.
 *
 * The ladder could not previously tell anybody how long they had, so it offered
 * "60 days to Forge" without knowing whether sixty days existed. Handed over as
 * a date *and* a count: the date is what goes in a calendar, the count is what
 * creates urgency, and deriving the count on the client would use the device
 * clock — the one number this engine never trusts.
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
  f public.challenge_enrollments%rowtype;
  s public.challenge_seasons%rowtype;
  fs public.challenge_seasons%rowtype;
  v_uid uuid := auth.uid();
  v_today date;
  v_required text[];
  v_outcome text;
  v_finished jsonb := null;
begin
  if v_uid is null then
    return jsonb_build_object('enrolled', false);
  end if;

  select * into f from public.challenge_enrollments
   where user_id = v_uid and status in ('completed', 'ended')
   order by coalesce(finished_at, completed_at, updated_at) desc
   limit 1;

  if found then
    select * into fs from public.challenge_seasons where id = f.season_id;
    v_finished := jsonb_build_object(
      'seasonId', f.season_id,
      'seasonName', fs.name,
      'status', f.status,
      'qualifiedDays', f.qualified_days,
      'tierDay', f.current_tier_day,
      'highestTierDay', f.highest_tier_day,
      'shieldsEarned', f.shields_earned,
      'finishedAt', coalesce(f.finished_at, f.completed_at)
    );
  end if;

  select * into e from public.challenge_enrollments
   where user_id = v_uid and status = 'active';
  if not found then
    return jsonb_build_object('enrolled', false, 'finishedRun', v_finished);
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
    'seasonName', s.name,
    'seasonState', public.challenge_season_state(s.id),
    'seasonEndsAt', s.ends_at,
    'localDay', v_today,
    'required', to_jsonb(v_required),
    'todayOutcome', v_outcome,
    'qualifiedDays', e.qualified_days,
    'perfectRun', e.perfect_run,
    'shields', e.shields,
    'shieldEarnDays', e.shield_earn_days,
    'tierDay', e.current_tier_day,
    'highestTierDay', e.highest_tier_day,
    'minWrites', s.min_writes,
    'minActiveSeconds', s.min_active_seconds,
    'requireLiveWrites', s.require_live_writes,
    'swapsLeft', greatest(s.module_swaps_allowed - e.swaps_used, 0),
    'swapsUnlockDay', e.enrolled_local_day + s.module_lock_days,
    'runEndsOn', e.run_ends_on,
    -- Today counts, so a run ending today has one day left, not none.
    'daysLeft', case when e.run_ends_on is null then null
                     else greatest((e.run_ends_on - v_today) + 1, 0) end,
    'finishedRun', v_finished
  );
end;
$$;

-- ===========================================================================
-- 6. THE CONSOLE CAN SET IT
--
-- 0065's patch function with one field added. Re-stated in full rather than
-- patched, because that is how every other change to it has been made and a
-- half-defined function is not a thing Postgres has.
--
-- Without this the whole migration is unreachable: `duration_days` would be a
-- column only a hand-written SQL statement could set, and the operator console
-- is the only place a season is configured.
-- ===========================================================================

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
    -- `? key`, not coalesce: null is a meaningful value here. Clearing the
    -- duration turns a rolling season back into a fixed-date one, and a
    -- coalesce could only ever set it, never unset it.
    duration_days = case when j ? 'durationDays'
                         then nullif(j ->> 'durationDays', '')::integer
                         else duration_days end,
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
-- 7. GRANTS
-- ===========================================================================

revoke all on function public.challenge_run_end_day(uuid, date, integer)
  from public, anon;
grant execute on function public.challenge_run_end_day(uuid, date, integer) to authenticated;

revoke all on function public.enroll_in_challenge(uuid, integer, text[], text[], text)
  from public, anon;
grant execute on function public.enroll_in_challenge(uuid, integer, text[], text[], text)
  to authenticated;

revoke all on function public.record_challenge_day(date, jsonb, integer, text) from public, anon;
grant execute on function public.record_challenge_day(date, jsonb, integer, text) to authenticated;

revoke all on function public.challenge_today() from public, anon;
grant execute on function public.challenge_today() to authenticated;

revoke all on function public.finalize_ended_seasons() from public, anon, authenticated;
grant execute on function public.finalize_ended_seasons() to service_role;
