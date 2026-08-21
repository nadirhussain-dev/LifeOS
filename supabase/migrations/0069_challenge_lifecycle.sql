-- ---------------------------------------------------------------------------
-- 0069 — The end of a run.
--
-- 0048 built an engine that can start a run and grow one, and stops there. Three
-- things it left open, all at the same edge — what happens when a run *ends*:
--
--   1. `record_challenge_day` guards on `enabled` and never on the season's own
--      dates, so days kept crediting after the season was over. The app reads
--      `challenge_season_state()` (0055) and says "this season has ended" while
--      the ledger behind it carries on awarding tiers. Two screens deriving the
--      same fact from different columns, which is the exact failure 0055 exists
--      to prevent — it just had one more place to live.
--
--   2. Nothing finished a run when its season did. `status` has allowed
--      'completed' since 0048 and only ever gets it by reaching the top rung, so
--      every other enrollment stays 'active' for ever. That is not only untidy:
--      `challenge_enrollments_one_active` is a unique index on (user_id) where
--      status = 'active', so season one's row blocks the same person joining
--      season two. The programme could not have had a second season.
--
--   3. `settle_stale_runs()` has been correct and unreachable since the day it
--      was written. It is granted to service_role and nothing calls it: no cron,
--      no edge function, no client path. The two public entry points cannot
--      stand in — `record_challenge_day` only ever credits, and
--      `challenge_today()` is `stable` and so cannot write at all. With no
--      settler, a miss costs nothing, a shield is never spent and demotion never
--      happens: the whole tension the ladder is built on was switched off.
--      `supabase/functions/challenge-maintenance` is the caller; this migration
--      gives it one idempotent entry point to call.
--
-- ## The status vocabulary
--
-- 'ended' is new, and it is deliberately not 'completed'. Finishing the ladder
-- and running out of calendar are different outcomes and the summary screen has
-- to tell them apart — "you finished Ember" and "the season ended while you were
-- on Ember" are not the same sentence. 'void' keeps its meaning (an operator
-- annulled the run) and is untouched here.
--
-- ## Why a finished run stays visible
--
-- `challenge_today()` selected `status = 'active'` and returned
-- `{enrolled:false}` for anything else, so the moment a run completed the app
-- fell back to its "start a run" card: finishing a months-long streak looked
-- exactly like never having started one, and the events timeline went with it
-- (the client keys that query off the season id this returns). The fix is not to
-- widen `enrolled` — every caller reads that as "has a run in progress" and
-- should keep doing so — but to hand back the finished run *alongside* it, so
-- the screen can show a summary and the join card at the same time.
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- 1. SCHEMA
-- ===========================================================================

alter table public.challenge_enrollments
  drop constraint if exists challenge_enrollments_status_check;

alter table public.challenge_enrollments
  add constraint challenge_enrollments_status_check
  check (status in ('active', 'completed', 'ended', 'void'));

/*
 * The timeline gains a beat for the season closing.
 *
 * `completed` already says "you finished the ladder"; this says "the calendar
 * ran out", and the two are the only entries in the timeline the user did not
 * cause themselves — which is exactly why both have to be there. A run that
 * simply stopped appearing would read as the app losing it.
 */
alter table public.challenge_events
  drop constraint if exists challenge_events_kind_check;

alter table public.challenge_events
  add constraint challenge_events_kind_check
  check (kind in (
    'enrolled', 'tier_reached', 'shield_earned', 'shield_spent', 'demoted',
    'module_swapped', 'completed', 'season_ended',
    'admin_shield_granted', 'admin_days_restored'
  ));

-- When the run stopped being live, whatever the reason. `completed_at` keeps
-- its narrower meaning — the moment the top rung was reached — so a completed
-- run carries both and an expired one carries only this.
alter table public.challenge_enrollments
  add column if not exists finished_at timestamptz;

-- ===========================================================================
-- 2. CREDITING RESPECTS THE SEASON WINDOW
-- ===========================================================================

/**
 * Unchanged from 0065 except for the window guard.
 *
 * The check is on the *claimed* day rather than on `now()`: submissions are
 * accepted for yesterday as well as today (that is what makes an offline night
 * survivable), so a day inside the season that is flushed the morning after it
 * ended must still count. Comparing `now()` would throw that day away and the
 * user would have earned it fairly.
 *
 * Both bounds are converted to the enrollment's own frozen local day, because
 * every other date in this engine is in that frame and mixing frames here is
 * how somebody in Auckland loses a day that somebody in Lisbon keeps.
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

  -- The season's own window, in this enrollment's local frame.
  v_opens := case when s.starts_at is null then null
                  else public.challenge_local_day(s.starts_at, e.tz_offset_minutes,
                                                  s.day_grace_hours) end;
  v_closes := case when s.ends_at is null then null
                   else public.challenge_local_day(s.ends_at, e.tz_offset_minutes,
                                                   s.day_grace_hours) end;

  if (v_opens is not null and p_local_day < v_opens)
     or (v_closes is not null and p_local_day > v_closes) then
    return jsonb_build_object('ok', false, 'reason', 'season closed',
                              'localDay', p_local_day);
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

  -- 0065's rule, unchanged: under the live rule the client's map is not read at
  -- all and only what the server witnessed counts.
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

-- ===========================================================================
-- 3. FINISHING A RUN WHOSE SEASON IS OVER
-- ===========================================================================

/**
 * Closes out every active run whose season has ended.
 *
 * Settles first, then finishes. The order is the whole point: the last days of
 * the season are still owed a verdict, and finishing the run before settling
 * them would quietly forgive whatever was missed at the end — the one stretch
 * where somebody who has already given up stops logging.
 *
 * Idempotent. It only touches runs still marked 'active', so a second call in
 * the same minute (or a retried cron) does nothing.
 *
 * Returns the number of runs finished, for the caller's log.
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
  v_close date;
  v_last date;
  v_finished integer := 0;
begin
  for r in
    select e.user_id, e.season_id, e.tz_offset_minutes, e.last_settled_day,
           e.qualified_days, s.day_grace_hours, s.ends_at
      from public.challenge_enrollments e
      join public.challenge_seasons s on s.id = e.season_id
     where e.status = 'active'
       and s.ends_at is not null
       and now() > s.ends_at
  loop
    v_close := public.challenge_local_day(r.ends_at, r.tz_offset_minutes, r.day_grace_hours);

    -- Every day of the season through its last one. `challenge_settle_missed_day`
    -- is a no-op for a day already in `challenge_days`, so a qualified day is
    -- not disturbed by being walked past.
    d := r.last_settled_day + 1;
    v_last := r.last_settled_day;
    while d <= v_close loop
      if not exists (
        select 1 from public.challenge_days
         where user_id = r.user_id and season_id = r.season_id and local_day = d
      ) then
        perform public.challenge_settle_missed_day(r.user_id, r.season_id, d);
      end if;
      v_last := d;
      d := d + 1;
    end loop;

    /*
     * 'ended', not 'completed'.
     *
     * A run that reached the top rung has already been marked 'completed' by
     * `challenge_credit_day` and is not in this loop at all, so anything here
     * ran out of calendar rather than finishing the ladder. Collapsing the two
     * would make the summary screen unable to tell somebody which of those
     * happened to them.
     */
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

-- `challenge_credit_day` marks a completed run but never stamped the general
-- "this run is over" column, so the two terminal states carried different
-- shapes. Backfilled here rather than in the function so existing rows agree.
update public.challenge_enrollments
   set finished_at = coalesce(finished_at, completed_at)
 where status = 'completed' and finished_at is null;

-- ===========================================================================
-- 4. ONE ENTRY POINT FOR THE CRON
-- ===========================================================================

/**
 * Everything that has to happen on a clock, in the order it has to happen in.
 *
 * Settle first: `finalize_ended_seasons` finishes runs, and a run finished
 * before its unsettled days are judged keeps whatever it missed at the end.
 *
 * One function rather than two calls from the caller, so the ordering is a
 * property of the database and not of whoever writes the next scheduler.
 *
 * Hourly is the right cadence and nightly is not: every date here is derived
 * from the enrollment's own frozen `tz_offset_minutes`, so "midnight" happens
 * at twenty-four different moments and a single nightly run settles most of the
 * cohort late. It is cheap — both loops touch only rows that are behind.
 */
create or replace function public.run_challenge_maintenance()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settled integer;
  v_finished integer;
begin
  v_settled := public.settle_stale_runs();
  v_finished := public.finalize_ended_seasons();
  return jsonb_build_object('settled', v_settled, 'finished', v_finished);
end;
$$;

-- ===========================================================================
-- 5. A FINISHED RUN STAYS READABLE
-- ===========================================================================

/**
 * Unchanged for anybody with a run in progress.
 *
 * `enrolled` keeps meaning exactly what it meant — there is a live run — because
 * every caller in the app reads it that way and widening it would turn a
 * finished season into a checklist somebody could try to tick.
 *
 * `finishedRun` is the addition: the most recent run that is over, so the screen
 * can show what it came to. Without it, completing the ladder returned
 * `{enrolled:false}` and the app offered to start a run — the same answer it
 * gives somebody who has never played.
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

  -- The last run that is over, whichever way it ended. Ordered by when it
  -- finished so a user with several seasons behind them sees the latest.
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
      -- Never decreases, so it is the honest answer to "how far did I get" even
      -- for a run that fell back down the ladder before the season closed.
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
    'finishedRun', v_finished
  );
end;
$$;

-- ===========================================================================
-- 6. GRANTS
--
-- `finalize_ended_seasons` and `run_challenge_maintenance` finish other
-- people's runs, so they are service_role only for the same reason
-- `settle_stale_runs` is.
-- ===========================================================================

revoke all on function public.finalize_ended_seasons() from public, anon, authenticated;
grant execute on function public.finalize_ended_seasons() to service_role;

revoke all on function public.run_challenge_maintenance() from public, anon, authenticated;
grant execute on function public.run_challenge_maintenance() to service_role;

revoke all on function public.record_challenge_day(date, jsonb, integer, text) from public, anon;
grant execute on function public.record_challenge_day(date, jsonb, integer, text) to authenticated;

revoke all on function public.challenge_today() from public, anon;
grant execute on function public.challenge_today() to authenticated;
