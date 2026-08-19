-- ---------------------------------------------------------------------------
-- 0066 — Counting the moments the plan is judged on.
--
-- ## The gap
--
-- docs/GROWTH_PLAN.md sets a go/no-go gate on every phase, and not one of them
-- was answerable. `usage_daily` (0010) counts opens and writes per module,
-- which says what people do once they are in the app and nothing about whether
-- they got there: onboarding completion, notification permission grant rate,
-- and which pacing rule stopped an ad were all invisible. So the phases shipped
-- against numbers nobody could see.
--
-- ## Counters, not an event log
--
-- The obvious answer is an events table with a timestamp and a name per row.
-- That is deliberately not what this is, because `usage-store.ts` already says
-- why: its shape is "structurally incapable of answering anything about
-- content", and an event log with per-action timestamps gives that property up
-- in exchange for questions nobody here is asking. Nothing below needs to know
-- the order two things happened in, or when — only how many installs reached
-- each milestone on each day.
--
-- So this is `usage_daily`'s shape with a different key: one row per (install,
-- day, metric) holding one integer. There is no timestamp per action, no
-- sequence, and no free-text field.
--
-- ## Why it is keyed to an install and never to an account
--
-- Two reasons, and the first is fatal on its own.
--
-- Onboarding largely happens before there is an account — the account step is
-- one of the things being measured, and guests never make one at all. A metric
-- requiring `auth.uid()` would be blind to exactly the population the
-- onboarding gate is about, and would report a completion rate computed only
-- over people who completed the account step.
--
-- And it is strictly less identifying than what already exists. `usage_daily`
-- is keyed to `user_id`; this is keyed to a random v4 UUID that resolves to no
-- account, no device identifier and no content — `install-id.ts`'s whole
-- argument. There is deliberately no user_id column: adding one later would be
-- a different privacy decision and should look like one.
--
-- ## Why the metric name is an allowlist
--
-- Same reasoning as `rate_limited_actions()` (0062). Reachable from an
-- unauthenticated session with a free-text name, this is an invitation to
-- insert a million distinct metrics and bloat the table — turning the thing
-- that measures the app into the thing that needs watching. An unknown metric
-- is skipped rather than stored, and the closed list is what lets the client's
-- own union be checked against it (features/analytics/config/funnel-metrics.ts,
-- and the test that holds the two together).
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- 1. THE ALLOWLIST
--
-- Grouped by the question each group answers. Adding one is a deliberate edit
-- here and in the client's union, which is the point — a metric that can be
-- invented at a call site is a metric nobody defined.
-- ===========================================================================

create or replace function public.funnel_metrics()
returns text[]
language sql
stable
as $$
  select array[
    -- First run, one per step reached. Drop-off is the difference between
    -- consecutive rungs, which is why each step is counted rather than only
    -- the start and the end.
    'onboarding_started',
    'onboarding_reached_account',
    'onboarding_reached_about',
    'onboarding_reached_focus',
    'onboarding_reached_shape',
    'onboarding_reached_learn',
    'onboarding_reached_lock',
    'onboarding_reached_ready',
    'onboarding_completed',

    -- The notification permission. `shown` is separate from the two answers
    -- because a prompt nobody reaches and a prompt everybody declines are the
    -- same number of grants and want opposite fixes.
    'notif_prompt_shown',
    'notif_permission_granted',
    'notif_permission_denied',

    -- Ads. The impression count is the numerator; the refusals are why the
    -- denominator is smaller than expected. Without them the only observable
    -- when revenue comes in under model is that it came in under model, with
    -- nothing to say which pacing rule spent it — see ad-pacing.ts, whose
    -- refusal reasons these mirror one for one.
    'ad_impression',
    'ad_refused_honeymoon',
    'ad_refused_first_session_of_day',
    'ad_refused_session_cap',
    'ad_refused_too_soon',
    'ad_refused_ad_free_route',
    'ad_refused_not_a_breakpoint',
    'ad_refused_launch'
  ]::text[];
$$;

-- ===========================================================================
-- 2. THE TABLE
-- ===========================================================================

create table if not exists public.funnel_daily (
  -- Text, not uuid, mirroring `anon_activity_daily` — the shape is checked on
  -- the way in and a malformed id must be a refusal rather than a cast error.
  install_id text not null,
  day date not null,
  metric text not null,
  count integer not null default 0,
  updated_at bigint not null,
  primary key (install_id, day, metric)
);

create index if not exists funnel_daily_day_idx on public.funnel_daily (day, metric);

alter table public.funnel_daily enable row level security;

-- No policy of any kind. Nobody reads this except an admin, through the
-- function below, and nobody writes it except `record_funnel`, which is a
-- definer. An install has no way to ask what it has reported and no reason to:
-- unlike `usage_daily`, whose owner can read their own row, there is no owner
-- here to show it to.

-- ===========================================================================
-- 3. RECORDING
--
-- Callable by `anon`, which `record_usage` is not, for the reason in the
-- header: the population being measured largely has no session yet.
-- ===========================================================================

create or replace function public.record_funnel(p_install_id text, p_entries jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_install_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'invalid install id' using errcode = 'invalid_parameter_value';
  end if;

  insert into public.funnel_daily (install_id, day, metric, count, updated_at)
  select p_install_id,
         (e ->> 'day')::date,
         e ->> 'metric',
         -- Clamped for the same reason `record_usage` clamps: a counter is a
         -- hint about behaviour, and one bad client must not be able to move a
         -- chart by six orders of magnitude.
         least(greatest(coalesce((e ->> 'count')::integer, 0), 0), 10000),
         (extract(epoch from now()) * 1000)::bigint
    from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb)) e
   where e ->> 'metric' = any (public.funnel_metrics())
     and e ->> 'day' is not null
     -- Only the last week, so a device with a wrong clock cannot write history.
     and (e ->> 'day')::date between current_date - 7 and current_date + 1
  on conflict (install_id, day, metric) do update
    set count = funnel_daily.count + excluded.count,
        updated_at = excluded.updated_at;
end;
$$;

-- ===========================================================================
-- 4. READING IT
-- ===========================================================================

/**
 * The funnel over a window, as totals and distinct installs.
 *
 * Both numbers, because they answer different questions and only one of them
 * is a funnel. `installs` is how many devices reached a step — the rate the
 * gates are written against. `total` is how many times it happened, which is
 * the useful one for ad impressions and the misleading one for onboarding,
 * where somebody who backs up and forward again is still one person.
 */
create or replace function public.admin_funnel_summary(p_days integer default 30)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_rows jsonb;
begin
  if not public.is_admin() then
    raise exception 'not an administrator' using errcode = 'insufficient_privilege';
  end if;

  select coalesce(jsonb_object_agg(metric, jsonb_build_object('total', total, 'installs', installs)),
                  '{}'::jsonb)
    into v_rows
    from (
      select f.metric,
             sum(f.count)::bigint as total,
             count(distinct f.install_id)::bigint as installs
        from public.funnel_daily f
       where f.day >= current_date - greatest(coalesce(p_days, 30), 1)
       group by f.metric
    ) rows;

  return v_rows;
end;
$$;

/**
 * Whether the streak engine is doing the job it was built for.
 *
 * `REWARDS_STRATEGY.md`'s Gate A is "enrolled D30 retention at least 2x the
 * control group", and it needed no new client instrumentation at all — every
 * number is already in `challenge_enrollments` and `challenge_days`. It was
 * unanswerable only because nothing asked.
 *
 * The control group is deliberately "everybody who was active on the day this
 * cohort enrolled and did not join", drawn from `usage_daily`. It is not a
 * randomised control and must not be quoted as one: people who join a streak
 * programme are more motivated to begin with, so this overstates the lift by
 * an unknown amount. It is still the comparison worth watching, because the
 * failure it is looking for — enrolled retention *below* the control — is
 * unambiguous whichever way the selection bias runs.
 */
create or replace function public.admin_challenge_retention(p_season uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_enrolled integer;
  v_alive integer;
  v_control integer;
  v_control_alive integer;
begin
  if not public.is_admin() then
    raise exception 'not an administrator' using errcode = 'insufficient_privilege';
  end if;

  -- Only cohorts old enough for the question to mean anything. Asking on day
  -- three returns "nobody has survived thirty days", which is true and useless.
  select count(*)::integer into v_enrolled
    from public.challenge_enrollments e
   where e.season_id = p_season
     and e.enrolled_local_day <= current_date - 30;

  select count(*)::integer into v_alive
    from public.challenge_enrollments e
   where e.season_id = p_season
     and e.enrolled_local_day <= current_date - 30
     and exists (
       select 1 from public.challenge_days d
        where d.user_id = e.user_id and d.season_id = e.season_id
          and d.local_day >= e.enrolled_local_day + 30
          and d.outcome in ('qualified', 'shielded')
     );

  -- Active on an enrolment day, never enrolled in this season.
  select count(distinct u.user_id)::integer into v_control
    from public.usage_daily u
   where u.day in (
           select distinct e.enrolled_local_day from public.challenge_enrollments e
            where e.season_id = p_season and e.enrolled_local_day <= current_date - 30
         )
     and not exists (
       select 1 from public.challenge_enrollments e2
        where e2.user_id = u.user_id and e2.season_id = p_season
     );

  select count(distinct u.user_id)::integer into v_control_alive
    from public.usage_daily u
   where u.day in (
           select distinct e.enrolled_local_day from public.challenge_enrollments e
            where e.season_id = p_season and e.enrolled_local_day <= current_date - 30
         )
     and not exists (
       select 1 from public.challenge_enrollments e2
        where e2.user_id = u.user_id and e2.season_id = p_season
     )
     and exists (
       select 1 from public.usage_daily u2
        where u2.user_id = u.user_id and u2.day >= u.day + 30
     );

  return jsonb_build_object(
    'cohort', v_enrolled,
    'aliveAt30', v_alive,
    'controlCohort', v_control,
    'controlAliveAt30', v_control_alive,
    -- Left null rather than zero when there is nobody to divide by. A rate of
    -- 0% and "no cohort yet" are very different readings and a dashboard that
    -- renders both as 0 will be believed.
    'rate', case when v_enrolled > 0 then round(v_alive::numeric / v_enrolled, 4) end,
    'controlRate', case when v_control > 0
                        then round(v_control_alive::numeric / v_control, 4) end
  );
end;
$$;

-- ===========================================================================
-- 5. GRANTS
-- ===========================================================================

revoke all on function public.record_funnel(text, jsonb) from public;
-- Both, deliberately: the onboarding funnel is reported by installs with no
-- session, and the ad funnel by installs that may have one.
grant execute on function public.record_funnel(text, jsonb) to anon, authenticated;

revoke all on function public.admin_funnel_summary(integer) from public, anon;
revoke all on function public.admin_challenge_retention(uuid) from public, anon;
grant execute on function public.admin_funnel_summary(integer) to authenticated;
grant execute on function public.admin_challenge_retention(uuid) to authenticated;
