-- ---------------------------------------------------------------------------
-- 0072 — One more ad refusal to count.
--
-- The streak programme now carries its own ad surface: an enrolled free account
-- gets a slightly higher session ceiling and a handful of extra breakpoints,
-- each of them at the end of a save inside a module that run actually committed
-- to. See `features/ads/services/ad-pacing.ts` for the placement argument, and
-- REWARDS_PROGRAM §0.1 for the rule those placements are shaped around — the ad
-- fires after the write and after the day is credited, never on the path to
-- either.
--
-- That adds a way for an ad to be refused which none of 0066's reasons
-- describes: the breakpoint exists and is well-formed, but this account is not
-- in a run, or is in one that did not commit to the module that fired it.
--
-- Kept distinct from `ad_refused_not_a_breakpoint` rather than folded into it,
-- because the two answer different questions and the fold would hide the more
-- interesting one. `not_a_breakpoint` counts calls from places that should not
-- be asking at all — a bug, and a small number. `not_enrolled` counts how much
-- of the new surface is actually reachable, which is the number that says
-- whether the extra ceiling is earning anything or whether it is a placement
-- almost nobody qualifies for. Under one name, a large second figure would look
-- like the first had gone wrong.
--
-- `funnel_metrics()` is `LANGUAGE SQL` and reads no tables, so this is a
-- straight replace with the one row added.
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
    'ad_refused_launch',
    -- 0072: a challenge breakpoint fired for somebody not in a run, or in a
    -- module they did not commit to.
    'ad_refused_not_enrolled'
  ]::text[];
$$;
