-- ---------------------------------------------------------------------------
-- 0067 — Telling somebody what a miss will cost, before it costs it.
--
-- The ladder, the shields and the fall have all existed since 0048, and the
-- app has never once told anybody what they were about to lose. The 20:00
-- reminder names the modules still outstanding, which is the actionable half;
-- the missing half is the number. "Journal and Water not logged" and "missing
-- today drops you from 84 days to 60" are the same fact and not remotely the
-- same message.
--
-- `challenge-math.ts` has computed that number since 0048 — `demotionTarget()`,
-- mirroring `challenge_settle_missed_day` branch for branch — and it could not
-- be used anywhere it mattered, because it needs three values the client was
-- never sent: how many misses are already inside the escalation window, the
-- season's cap on a single fall, and the ladder itself.
--
-- So `challenge_today()` sends them. All three go in the response the app
-- already makes on every foreground rather than a second round trip, because
-- the consumer is a local notification rebuilt on every write, and a reminder
-- that had to fetch before it could be rescheduled is a reminder that is wrong
-- whenever the network is.
--
-- Copied and amended rather than patched in place, for the same reason 0065
-- did: 0055 has already been applied by hand, and editing an applied migration
-- changes nothing that is already running.
-- ---------------------------------------------------------------------------

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
    'seasonName', s.name,
    -- 'open' here means "today can still be earned". Anything else is the
    -- explanation the checklist owes the user before they do the work.
    'seasonState', public.challenge_season_state(e.season_id),
    'seasonEndsAt', s.ends_at,
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
    'swapsLeft', greatest(s.module_swaps_allowed - e.swaps_used, 0),
    'swapsUnlockDay', e.enrolled_local_day + s.module_lock_days,
    -- Everything `demotionTarget()` needs, in the response the client already
    -- makes. Three fields rather than a second round trip, because the caller
    -- that needs them is a local notification being rebuilt on every write —
    -- see challenge-reminders.ts.
    'recentMisses', e.recent_misses,
    'maxDemotionDays', s.max_demotion_days,
    'tierThresholds', coalesce((
      select jsonb_agg(t.day_threshold order by t.day_threshold)
        from public.challenge_tiers t where t.season_id = e.season_id
    ), '[]'::jsonb)
  );
end;
$$;
