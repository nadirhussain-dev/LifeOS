-- ---------------------------------------------------------------------------
-- 0049 — What the operator can see about the challenge, and nothing more.
--
-- 0048 gave every challenge table an owner-only read policy, which is correct
-- and leaves the operator console with no way to answer the questions it exists
-- to answer: how many people are running, is the shield economy tuned right,
-- and which module is quietly costing everybody their days.
--
-- All four functions below return **aggregates only**. None of them takes a
-- user id, none returns a row that identifies anybody, and none can be coaxed
-- into doing so — which is the same line 0010 drew for usage: a console that
-- needs to know how many, not who.
--
-- ## The retention function, and an honest caveat
--
-- `admin_challenge_retention` answers the one question the whole programme is
-- gated on: do people who join a run stick around more than people who do not.
-- It cannot answer it cleanly, and the reason is worth writing down rather than
-- burying in a dashboard.
--
-- The enrolled cohort has a perfect signal — `challenge_days` is a server-side
-- ledger of exactly who was active on which day. The control group has no such
-- thing. The only record of a non-enrolled user's activity is `usage_daily`,
-- which is **opt-in and off by default** (see the header of 0010 and
-- features/analytics/store/usage-store.ts). So the comparison is drawn only
-- across accounts that consented to analytics, and consent may itself correlate
-- with engagement.
--
-- That is a biased denominator and the function says so in its own output
-- (`control_is_consenting_only`), so a number this decision rests on cannot be
-- read off a chart without the caveat attached. It is good enough for the
-- threshold it is measured against — a 2x difference is a large effect and
-- survives a lot of bias — and it is not good enough to publish. If the answer
-- lands near the line rather than clearly over it, the honest next step is an
-- aggregate-only retention counter that identifies nobody, not a more confident
-- reading of this one.
-- ---------------------------------------------------------------------------

/**
 * Headline counts for a season, split by the plan somebody was on when they
 * joined. Free and paying are different businesses with different completion
 * rates and different costs, and averaging them hides both.
 */
create or replace function public.admin_challenge_overview(p_season uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if not public.is_staff() then
    raise exception 'not an operator' using errcode = 'insufficient_privilege';
  end if;

  select jsonb_build_object(
    'enrolled', count(*),
    'active', count(*) filter (where e.status = 'active'),
    'completed', count(*) filter (where e.status = 'completed'),
    'paying', count(*) filter (where e.plan_at_enrolment is distinct from 'free'),
    'medianQualifiedDays', coalesce(
      percentile_cont(0.5) within group (order by e.qualified_days), 0
    ),
    'atLeast30Days', count(*) filter (where e.qualified_days >= 30),
    'atLeast90Days', count(*) filter (where e.qualified_days >= 90)
  )
  into v_result
  from public.challenge_enrollments e
  where e.season_id = p_season;

  return coalesce(v_result, '{}'::jsonb);
end;
$$;

/**
 * The shield economy, which is the dial that actually gets tuned.
 *
 * If almost nobody ever spends a shield the earn rate is too generous and the
 * buffer is doing no motivational work; if everybody sits at zero it is too
 * tight and the demotion rule is doing all the work instead. The useful reading
 * is the share of runs that have been saved at least once.
 */
create or replace function public.admin_challenge_shield_telemetry(p_season uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if not public.is_staff() then
    raise exception 'not an operator' using errcode = 'insufficient_privilege';
  end if;

  select jsonb_build_object(
    'earned', coalesce(sum(e.shields_earned), 0),
    'held', coalesce(sum(e.shields), 0),
    'spent', coalesce(sum(d.shielded), 0),
    'runsSavedAtLeastOnce', count(*) filter (where d.shielded > 0),
    'runs', count(*)
  )
  into v_result
  from public.challenge_enrollments e
  left join lateral (
    select count(*) as shielded
      from public.challenge_days cd
     where cd.user_id = e.user_id
       and cd.season_id = e.season_id
       and cd.outcome = 'shielded'
  ) d on true
  where e.season_id = p_season;

  return coalesce(v_result, '{}'::jsonb);
end;
$$;

/**
 * Which committed module is missing on the days people lose.
 *
 * The single most actionable number the console has. A module responsible for a
 * large share of all failures is a module that should probably not be eligible
 * — it is setting people up to fail for reasons that have nothing to do with
 * discipline — and this is the only place that would ever surface it.
 *
 * Read off `modules_hit`: for every failed day, the required modules that were
 * not in the array. That is why 0048 stores the array rather than a boolean.
 */
create or replace function public.admin_challenge_module_failures(p_season uuid)
returns table (module_id text, failed_days bigint)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then
    raise exception 'not an operator' using errcode = 'insufficient_privilege';
  end if;

  return query
  select m.module_id, count(*) as failed_days
    from public.challenge_days d
    join public.challenge_enrollment_modules m
      on m.user_id = d.user_id
     and m.season_id = d.season_id
     and m.role = 'required'
     and m.added_on <= d.local_day
     and (m.removed_on is null or m.removed_on > d.local_day)
   where d.season_id = p_season
     and d.outcome in ('missed', 'shielded')
     and not (m.module_id = any (d.modules_hit))
   group by m.module_id
   order by count(*) desc;
end;
$$;

/**
 * The Gate A number: 30-day retention for people in a run against people who
 * are not. See the header for why the control side is weaker than it looks.
 */
create or replace function public.admin_challenge_retention(p_season uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enrolled_total integer;
  v_enrolled_kept integer;
  v_control_total integer;
  v_control_kept integer;
begin
  if not public.is_staff() then
    raise exception 'not an operator' using errcode = 'insufficient_privilege';
  end if;

  -- Only runs old enough to have had the chance. Counting somebody who joined
  -- last week as "did not reach 30 days" is how a retention number gets talked
  -- down by its own denominator.
  select count(*),
         count(*) filter (where e.qualified_days >= 30)
    into v_enrolled_total, v_enrolled_kept
    from public.challenge_enrollments e
   where e.season_id = p_season
     and e.enrolled_local_day <= current_date - 30;

  -- The control group: accounts with usage recorded, never enrolled in this
  -- season, whose first recorded day is at least 30 days ago. "Kept" means they
  -- were still active on any day at least 30 days after that first one.
  with first_seen as (
    select u.user_id, min(u.day) as started
      from public.usage_daily u
     where not exists (
       select 1 from public.challenge_enrollments e
        where e.user_id = u.user_id and e.season_id = p_season
     )
     group by u.user_id
    having min(u.day) <= current_date - 30
  )
  select count(*),
         count(*) filter (
           where exists (
             select 1 from public.usage_daily u2
              where u2.user_id = f.user_id
                and u2.day >= f.started + 30
           )
         )
    into v_control_total, v_control_kept
    from first_seen f;

  return jsonb_build_object(
    'enrolledTotal', v_enrolled_total,
    'enrolledKept', v_enrolled_kept,
    'controlTotal', v_control_total,
    'controlKept', v_control_kept,
    -- Stated in the payload rather than only in a comment, so the caveat
    -- travels with the number to wherever it ends up being quoted.
    'controlIsConsentingOnly', true
  );
end;
$$;

revoke all on function public.admin_challenge_overview(uuid) from public, anon;
revoke all on function public.admin_challenge_shield_telemetry(uuid) from public, anon;
revoke all on function public.admin_challenge_module_failures(uuid) from public, anon;
revoke all on function public.admin_challenge_retention(uuid) from public, anon;
grant execute on function public.admin_challenge_overview(uuid) to authenticated;
grant execute on function public.admin_challenge_shield_telemetry(uuid) to authenticated;
grant execute on function public.admin_challenge_module_failures(uuid) to authenticated;
grant execute on function public.admin_challenge_retention(uuid) to authenticated;
