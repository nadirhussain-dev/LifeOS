-- ---------------------------------------------------------------------------
-- 0077 — The metric that makes retention answerable.
--
-- ## The gap
--
-- 0066 made the onboarding funnel and the ad pacing observable, and both are
-- about *reaching* a moment once. Nothing in the allowlist says whether anybody
-- came back the next day, the next week, or the next month — so D1/D7/D30 were
-- not "hard to query", they were absent from the data model. Every growth
-- decision was therefore being taken against install-time numbers, which are
-- the half of the picture that flatters a product.
--
-- `usage_daily` (0010) looks like it should already answer this and cannot, for
-- one structural reason: it is keyed to `user_id`. Guests never have one, and
-- guests are a first-class mode here — so a retention curve built on it would
-- silently be a retention curve for signed-in accounts only, computed over the
-- population most likely to return. That is a worse number than none.
--
-- ## Why this needs no new table
--
-- `funnel_counters` is already keyed `(install_id, day, metric)` with an integer
-- count, which is exactly the shape retention wants: a row existing for
-- `app_opened` on a day means that install was active that day. Cohort day is
-- the earliest day the install appears. D-N retention is then a self-join on
-- the same table and nothing else, and it covers guests because the key is an
-- install rather than an account.
--
-- So this migration adds one name to the allowlist. No schema change, no new
-- RLS policy, and no new privacy surface: the row is a count against a random
-- v4 UUID that resolves to no account, no device and no content — the same
-- argument 0066 makes at length for every other metric in the list.
--
-- ## What it deliberately does not add
--
-- A per-module engagement metric. The question "which modules predict
-- retention" wants module identity beside the day-activity above, and the two
-- available keys do not join: this table is keyed to an install, `usage_daily`
-- to an account. Bridging them means putting a user_id next to an install_id,
-- which is a different privacy decision from any taken so far and should be
-- made deliberately rather than arrive as a side effect of adding a counter.
-- Left out until somebody decides it.
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
    -- denominator is smaller than expected.
    'ad_impression',
    'ad_refused_honeymoon',
    'ad_refused_first_session_of_day',
    'ad_refused_session_cap',
    'ad_refused_too_soon',
    'ad_refused_ad_free_route',
    'ad_refused_not_a_breakpoint',
    'ad_refused_launch',
    'ad_refused_not_enrolled',

    -- 0077: one per foreground session. A row on a day means the install was
    -- active that day, which is all D1/D7/D30 needs.
    'app_opened'
  ]::text[];
$$;
