-- ---------------------------------------------------------------------------
-- 0055 — One name for what a season is doing, and a console that can change it.
--
-- 0048 shipped the streak challenge with every knob in data and no screen for
-- any of them. Seasons, rungs and eligible modules were created by hand, which
-- produced the failure this migration exists to end:
--
--   * `challenge_seasons` had an enabled row inside its date window, so the
--     operator console — which checks exactly those three things — showed the
--     season as **Open**.
--   * `challenge_modules` had nothing in it, so the app's own check (a season
--     you cannot enrol in is not open) returned null and every user was told
--     **"No season is open right now"**.
--
-- Both were correct. They were answering different questions, and neither
-- screen knew the other question existed, so the gap between them could only be
-- found by reading two files. Staging sat in that state from 2026-08-16.
--
-- ## 1. One function names the state, and both sides quote it
--
-- `challenge_season_state()` is the whole fix. It returns one of seven words —
-- `none`, `closed`, `upcoming`, `ended`, `notReady`, `full`, `open` — and every
-- other surface reads it rather than re-deriving it:
--
--   * `challenge_season_status()` for the app, so the join screen can say *why*
--     and *when* instead of going quiet;
--   * `admin_challenge_seasons()` for the console, so an operator sees the
--     exact word the user's phone is showing;
--   * `challenge_today()`, extended below, so somebody already in a run learns
--     that the programme was paused rather than watching their check-ins fail
--     into silence.
--
-- The two consoles can no longer disagree, because there is only one answer and
-- they both quote it.
--
-- `notReady` is deliberately `eligible < required_modules`, not `eligible = 0`.
-- A season asking for three commitments with two eligible modules is exactly as
-- unjoinable as one with none; the picker just fails further along.
--
-- ## 2. Partial updates, because "extend by a week" must not rewrite the rules
--
-- 0048's `admin_upsert_challenge_season` takes the whole settings object and
-- coalesces every missing key to its default. Calling it to move an end date
-- silently resets `shield_cap`, `min_writes` and nine other knobs to factory
-- values — for a season people are two hundred days into.
--
-- `admin_update_challenge_season` patches only the keys actually present in the
-- jsonb it is handed. The upsert stays for creation, where defaults are what
-- you want.
--
-- ## 3. Seeding is a function, not a paragraph in a runbook
--
-- `challenge_seed_season_defaults()` fills an empty season with the eight
-- naturally-daily modules and the reference ladder from docs/REWARDS_PROGRAM.md.
-- It is called three ways: by the operator's "Add the default set" button, and
-- once at the bottom of this file against any season already enabled — which is
-- what repairs staging as this migration applies.
--
-- It only ever fills gaps. A season with one curated module keeps exactly that
-- one module; a season with a ladder keeps its ladder. Seeding must never be
-- able to overwrite a deliberate choice, because the operator pressing the
-- button is usually not the person who made that choice.
-- ---------------------------------------------------------------------------

-- --- what a season is doing, in one word -----------------------------------
--
-- SECURITY DEFINER because the honest answer needs the enrolment count, and RLS
-- — quite rightly — shows an account only its own row. Nothing about a single
-- account leaves this function; the count is only ever compared against the cap
-- and thrown away.
--
-- Order matters and is the order an operator would ask in: does it exist, is it
-- switched on, has it started, has it finished, can it be joined, is there room.
-- The first failure wins, because that is the one worth reporting — a season
-- that is both closed and empty needs switching on before its modules matter.
create or replace function public.challenge_season_state(p_season uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s public.challenge_seasons%rowtype;
  v_eligible integer;
  v_enrolled integer;
begin
  if p_season is null then
    return 'none';
  end if;

  select * into s from public.challenge_seasons where id = p_season;
  if not found then
    return 'none';
  end if;

  -- The season's own switch, which is not the `rewards` module flag. The flag
  -- decides whether anybody can see the programme; this decides whether they
  -- can be in it. Both are legitimately called "enabled" in conversation and
  -- confusing them is how the console ends up describing a season nobody can
  -- reach.
  if not s.enabled then
    return 'closed';
  end if;
  if s.starts_at is not null and now() < s.starts_at then
    return 'upcoming';
  end if;
  if s.ends_at is not null and now() > s.ends_at then
    return 'ended';
  end if;

  select count(*)::integer into v_eligible
    from public.challenge_modules
   where season_id = p_season and eligible;
  if v_eligible < s.required_modules then
    return 'notReady';
  end if;

  if s.max_enrollments is not null then
    select count(*)::integer into v_enrolled
      from public.challenge_enrollments where season_id = p_season;
    if v_enrolled >= s.max_enrollments then
      return 'full';
    end if;
  end if;

  return 'open';
end;
$$;

-- --- the app's single read -------------------------------------------------
--
-- Replaces three client round trips (season, tiers, modules) and, more to the
-- point, replaces the client's *inference*. The app used to conclude "no season"
-- from an empty module list, which is true but useless: it cannot tell somebody
-- the programme starts on Tuesday, because by then the reason has been thrown
-- away.
--
-- Readable signed-out, like `module_flags` and the tables underneath it, because
-- it describes the programme rather than a person — which is what lets the join
-- screen show a visitor what they would be signing up for before they have an
-- account.
--
-- Which season it describes, when several exist: the one somebody could join
-- now, else the one starting soonest, else the one that ended most recently.
-- That order is "what can I do", "what can I wait for", "what did I miss", which
-- is the order the question is actually asked in. Seasons switched off are
-- invisible here — an operator's half-built draft is not news.
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

-- --- the same word, for somebody already in a run --------------------------
--
-- Replaces 0048's version to carry the season's name, state and end date.
--
-- Without them a paused season is invisible from inside: `record_challenge_day`
-- returns `{ok: false, reason: 'season paused'}` and the checklist, which has no
-- field for a reason, simply never ticks. The user does the work, presses
-- nothing wrong, and watches the day not count. Everything else here is
-- unchanged from 0048.
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
    'swapsUnlockDay', e.enrolled_local_day + s.module_lock_days
  );
end;
$$;

-- --- filling an empty season ------------------------------------------------
--
-- Not admin-gated, and not granted to anybody: this is the shared body, called
-- by the operator's button (which is gated) and by the backfill at the foot of
-- this file (which runs as the migration). Splitting it this way is what lets
-- the repair and the button be the same code — a runbook paragraph and a button
-- that are supposed to do the same thing eventually stop doing the same thing.
--
-- The module ids are the **sync registry's keys**
-- (features/sync/config/sync-tables.ts), because that is what the client's
-- write-attribution map is derived from. A module seeded under any other
-- vocabulary is one nobody can ever satisfy: the writes arrive attributed to
-- `habits` and the contract is waiting for `Habits`.
--
-- The set is the one docs/REWARDS_PROGRAM.md §1.2.1 argues for: naturally daily
-- things only. Budget, gallery and music are deliberately absent — committing
-- to a module that has empty days by nature sets somebody up to fail for
-- reasons that have nothing to do with discipline.
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
      (season_id, day_threshold, name, reward_kind, reward_title, sort_order)
    select p_season, d.day, d.name, d.kind, d.title, d.day
      from (values
        (  7, 'Spark',     'digital',  'Badge and an exclusive gradient theme'),
        ( 30, 'Ember',     'digital',  'Exclusive app icon, and your first shield'),
        ( 60, 'Flame',     'digital',  'A shareable sixty-day stats card'),
        ( 90, 'Blaze',     'digital',  'Your name on the finishers wall, if you want it'),
        (120, 'Keystone',  'digital',  'The gift box becomes visible, and named'),
        (180, 'Half Year', 'digital',  'Prestige badge, profile frame, storage bump'),
        (240, 'Forge',     'digital',  'Custom chain colours and an animated badge'),
        (300, 'Summit',    'digital',  'A personalised film of your year so far'),
        (365, 'Year One',  'physical', 'The physical gift box, claimable')
      ) as d(day, name, kind, title)
    on conflict (season_id, day_threshold) do nothing;
    get diagnostics v_tiers = row_count;
  end if;

  return jsonb_build_object('ok', true, 'modulesAdded', v_modules, 'tiersAdded', v_tiers);
end;
$$;

-- --- the console's read ----------------------------------------------------
--
-- Every season, each carrying the state word the app is showing for it and the
-- three counts that explain that word. The counts are the point: "Not joinable"
-- next to "0 of 3 modules" is a sentence an operator can act on, where "Not
-- joinable" on its own is one more thing to go and check by hand.
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

-- --- the console's writes ---------------------------------------------------

/**
 * The season's own switch, on its own.
 *
 * Separate from the patch below because this is the one an operator reaches for
 * under pressure, and it must not be possible to change anything else while
 * doing it. Switching a season off stops new enrolments *and* pauses every
 * running one (`record_challenge_day` refuses on a disabled season) — which is
 * the correct behaviour for "stop the programme now", and is why the app was
 * taught to say so out loud in `challenge_today` above.
 */
create or replace function public.admin_set_challenge_season_enabled(
  p_season uuid,
  p_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state text;
begin
  if not public.is_admin() then
    raise exception 'not an administrator' using errcode = 'insufficient_privilege';
  end if;

  update public.challenge_seasons
     set enabled = coalesce(p_enabled, false), updated_at = now()
   where id = p_season;
  if not found then
    raise exception 'no such season';
  end if;

  insert into public.admin_audit_log (actor, action, target_user, detail)
  values (auth.uid(), 'challenge_season_enabled', null,
          jsonb_build_object('season', p_season, 'enabled', p_enabled));

  v_state := public.challenge_season_state(p_season);
  return jsonb_build_object('ok', true, 'state', v_state);
end;
$$;

/**
 * A partial update: only the keys present in `p_patch` are touched.
 *
 * This is what makes "extend by a week" safe. 0048's upsert takes the whole
 * settings object and coalesces every absent key to its factory default, so a
 * console that sent `{endsAt}` would quietly reset the shield economy of a
 * season people are two hundred days into. Here an absent key means "leave it",
 * and an explicit null means "clear it" — which is a distinction jsonb can
 * make and a function signature of eighteen nullable arguments cannot.
 *
 * Dates are the reason this exists, so both directions work: an end date may be
 * moved out to extend a season or pulled in to shorten one, including to a
 * moment already past, which is how a season is ended early without switching
 * it off and pausing everyone's run.
 */
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

/** The operator's "Add the default set". Gated and audited; the work is the
 *  shared helper, so the button and the repair below cannot drift. */
create or replace function public.admin_seed_challenge_season(p_season uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if not public.is_admin() then
    raise exception 'not an administrator' using errcode = 'insufficient_privilege';
  end if;

  v_result := public.challenge_seed_season_defaults(p_season);

  insert into public.admin_audit_log (actor, action, target_user, detail)
  values (auth.uid(), 'challenge_season_seed', null,
          jsonb_build_object('season', p_season, 'result', v_result));

  return v_result || jsonb_build_object('state', public.challenge_season_state(p_season));
end;
$$;

/** Removes one rung. Ladders get edited while a season is being built, and
 *  0048 could add a rung but never take one back — which left a typo'd
 *  threshold permanently on the ladder every user can read. */
create or replace function public.admin_delete_challenge_tier(p_season uuid, p_day integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not an administrator' using errcode = 'insufficient_privilege';
  end if;

  delete from public.challenge_tiers where season_id = p_season and day_threshold = p_day;

  insert into public.admin_audit_log (actor, action, target_user, detail)
  values (auth.uid(), 'challenge_delete_tier', null,
          jsonb_build_object('season', p_season, 'day', p_day));
end;
$$;

/**
 * Deletes a season, and only ever an unused one.
 *
 * The refusal is the feature. Every challenge table cascades from this row, so
 * deleting a season with runs in it would take the ledger, the event history
 * and the enrolment contracts of everybody in it — silently, and with no way
 * back. A season that has been joined is closed, never removed; the button that
 * does that is one tap away and reversible.
 */
create or replace function public.admin_delete_challenge_season(p_season uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enrolled integer;
begin
  if not public.is_admin() then
    raise exception 'not an administrator' using errcode = 'insufficient_privilege';
  end if;

  select count(*)::integer into v_enrolled
    from public.challenge_enrollments where season_id = p_season;
  if v_enrolled > 0 then
    raise exception 'season has % enrolment(s); close it instead', v_enrolled;
  end if;

  delete from public.challenge_seasons where id = p_season;

  insert into public.admin_audit_log (actor, action, target_user, detail)
  values (auth.uid(), 'challenge_delete_season', null,
          jsonb_build_object('season', p_season));

  return jsonb_build_object('ok', true);
end;
$$;

-- --- grants ----------------------------------------------------------------
--
-- The state helper is called from inside the definers above, which execute as
-- their owner, so nothing needs it directly. Revoked rather than left open: it
-- reads the enrolment table.
revoke all on function public.challenge_season_state(uuid) from public, anon, authenticated;
revoke all on function public.challenge_seed_season_defaults(uuid) from public, anon, authenticated;

revoke all on function public.admin_challenge_seasons() from public, anon;
revoke all on function public.admin_set_challenge_season_enabled(uuid, boolean) from public, anon;
revoke all on function public.admin_update_challenge_season(uuid, jsonb) from public, anon;
revoke all on function public.admin_seed_challenge_season(uuid) from public, anon;
revoke all on function public.admin_delete_challenge_tier(uuid, integer) from public, anon;
revoke all on function public.admin_delete_challenge_season(uuid) from public, anon;

grant execute on function public.admin_challenge_seasons() to authenticated;
grant execute on function public.admin_set_challenge_season_enabled(uuid, boolean) to authenticated;
grant execute on function public.admin_update_challenge_season(uuid, jsonb) to authenticated;
grant execute on function public.admin_seed_challenge_season(uuid) to authenticated;
grant execute on function public.admin_delete_challenge_tier(uuid, integer) to authenticated;
grant execute on function public.admin_delete_challenge_season(uuid) to authenticated;

-- Signed-out too, for the same reason the tables underneath it are: the join
-- screen has to be able to show a visitor what they would be signing up for.
grant execute on function public.challenge_season_status() to anon, authenticated;

-- --- the repair -------------------------------------------------------------
--
-- Any season already switched on gets the default modules and ladder if it has
-- none. This is the statement that fixes the live symptom: an enabled staging
-- season with an empty `challenge_modules`, which every user's phone has been
-- correctly reporting as "no season is open" since 2026-08-16.
--
-- Safe to re-run, and safe on a database that has none of this — the helper
-- fills gaps only, and a season somebody has already curated is left exactly as
-- they left it.
do $$
declare
  r record;
begin
  for r in select id from public.challenge_seasons where enabled loop
    perform public.challenge_seed_season_defaults(r.id);
  end loop;
end;
$$;
