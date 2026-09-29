-- ---------------------------------------------------------------------------
-- 0078 — Remove the streak programme.
--
-- The whole feature is being rebuilt from scratch, so this drops it rather than
-- switching it off. 0074's pattern — seed the flag `false` and leave the schema
-- in place — was right while the programme was being *held back*; it is the
-- wrong shape for something nobody intends to ship in this form again, because
-- a disabled feature's tables still accumulate rows through any path the flag
-- does not cover, and its functions are still callable by anything holding a
-- session.
--
-- ## What this is careful not to take with it
--
-- 0049, 0055 and 0071 each carry billing objects alongside the challenge ones —
-- `coupons`, `coupon_redemptions`, `plan_coupon_variants`, `checkout_intents`,
-- `validate_coupon`, `grant_premium_window` and the `admin_*_coupon` family.
-- Those are the subscription system, which is a separate removal with its own
-- decisions to make. They are deliberately untouched here, and anyone doing
-- that pass should read this note rather than assume the challenge migrations
-- were purely challenge.
--
-- `admin_grant_premium` and `grant_premium_window` are borderline: they exist
-- because the programme paid out bounded Premium windows. They stay, because
-- they are named and shaped as billing operations and dropping them here would
-- make the subscription removal look smaller than it is.
--
-- ## Functions are dropped by name lookup, not by signature
--
-- Several were replaced with different argument lists across 0048 → 0075, so a
-- hardcoded `drop function public.f(uuid, date)` would silently miss an older
-- overload that is still callable. Enumerating `pg_proc` drops every overload
-- of every listed name and cannot drift from what is actually installed.
--
-- ## Order
--
-- Functions first, then tables. The other way round works too (the drops
-- cascade), but dropping a table out from under a function that reads it leaves
-- the function in place and broken for as long as the migration takes, and
-- there is no reason to have that window.
-- ---------------------------------------------------------------------------

do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'admin_challenge_module_failures',
        'admin_challenge_overview',
        'admin_challenge_retention',
        'admin_challenge_seasons',
        'admin_challenge_shield_telemetry',
        'admin_delete_challenge_season',
        'admin_delete_challenge_tier',
        'admin_grant_challenge_shield',
        'admin_restore_challenge_days',
        'admin_seed_challenge_season',
        'admin_set_challenge_module',
        'admin_set_challenge_season_enabled',
        'admin_update_challenge_season',
        'admin_upsert_challenge_season',
        'admin_upsert_challenge_tier',
        'attest_challenge_write',
        'challenge_apply_reward',
        'challenge_credit_day',
        'challenge_grant_tier_rewards',
        'challenge_live_today',
        'challenge_local_day',
        'challenge_rank',
        'challenge_reward_effect_ok',
        'challenge_run_end_day',
        'challenge_season_state',
        'challenge_season_status',
        'challenge_seed_season_defaults',
        'challenge_settle_missed_day',
        'challenge_tier_day_at',
        'challenge_today',
        'enroll_in_challenge',
        'finalize_ended_seasons',
        'my_challenge_rewards',
        'record_challenge_day',
        'run_challenge_maintenance',
        'settle_stale_runs',
        'swap_challenge_module',
        'sync_my_challenge_rewards'
      )
  loop
    execute format('drop function if exists %s cascade', fn.signature);
  end loop;
end
$$;

drop table if exists public.challenge_live_writes cascade;
drop table if exists public.challenge_events cascade;
drop table if exists public.challenge_days cascade;
drop table if exists public.challenge_enrollment_modules cascade;
drop table if exists public.challenge_enrollments cascade;
drop table if exists public.challenge_tiers cascade;
drop table if exists public.challenge_modules cascade;
drop table if exists public.challenge_seasons cascade;
drop table if exists public.user_rewards cascade;

-- The flag the programme was gated under. 0011 rule 1 treats an absent row as
-- enabled, which is exactly why this row existed at all — but there is no
-- longer a module for it to enable, and leaving it behind means the operator
-- console lists a switch for something that does not exist.
delete from public.module_flags where module = 'rewards';

-- ---------------------------------------------------------------------------
-- The funnel allowlist loses the refusal that only the programme could produce.
--
-- `ad_refused_not_enrolled` (0072) counted a challenge breakpoint reached by
-- somebody not in a run. There are no challenge breakpoints now, so the client
-- can never send it — and an allowlisted name nothing emits reads, to anyone
-- querying this later, as a metric at zero rather than a metric that is gone.
--
-- `funnel_metrics()` is LANGUAGE SQL and reads no tables, so this is a straight
-- replace. Kept in filename order with the rest: the *last* migration defining
-- this signature is the live body, which is what
-- `features/analytics/config/funnel-metrics.test.ts` reads back.
-- ---------------------------------------------------------------------------

create or replace function public.funnel_metrics()
returns text[]
language sql
stable
as $$
  select array[
    -- Onboarding, step by step. Each is the *furthest* point reached, so a
    -- funnel is a series of counts that only ever decreases.
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
    -- denominator is smaller than expected.
    'ad_impression',
    'ad_refused_honeymoon',
    'ad_refused_first_session_of_day',
    'ad_refused_session_cap',
    'ad_refused_too_soon',
    'ad_refused_ad_free_route',
    'ad_refused_not_a_breakpoint',
    'ad_refused_launch',

    -- One per foreground session, keyed to an install rather than an account,
    -- which is what makes D1/D7/D30 answerable for guests too (0077).
    'app_opened'
  ]::text[];
$$;
