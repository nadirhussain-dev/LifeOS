-- 0030 — Lower the per-account media quota to fit the project's actual
-- Supabase plan.
--
-- 0026 set `media_quota_bytes()` to 2 GiB per account and said outright that
-- the number was "a placeholder chosen to be obviously finite, not a costed
-- decision." It was never revisited before this project went on the
-- Supabase free tier, whose Storage bucket holds 1 GB **total, for every
-- account combined** — meaning a single account backing up a real photo
-- library could exhaust the entire project's storage before a second
-- account ever uploaded anything, and every other account's uploads would
-- then fail with a quota error that had nothing to do with their own usage.
--
-- 150 MiB is still a placeholder, not a costed one either — it is chosen so
-- roughly six to seven fully-maxed-out free accounts fit inside the 1 GB
-- project cap with headroom, while a typical account (nobody fills their
-- quota exactly) supports far more than that in practice. Raise this again
-- the moment the project moves off the free plan — `media_quota_bytes()`
-- remains the one place that decides, for both the `media` bucket (0026) and
-- the `shared-albums` bucket, which bills against the same ceiling (0028).
create or replace function public.media_quota_bytes()
returns bigint
language sql
immutable
as $$
  select 157286400::bigint;  -- 150 MiB
$$;
