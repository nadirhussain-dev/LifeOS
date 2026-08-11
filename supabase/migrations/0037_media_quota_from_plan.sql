-- 0037 — media_quota_bytes() finally reads the account's actual plan,
-- instead of one flat number every account shared regardless of what they're
-- paying for. Lowers the free tier's number to 50 MB in the same move.
--
-- 0026 defined it as a hardcoded constant with its own header warning that
-- the number was "a placeholder... not a costed decision". 0030 lowered that
-- constant to 150 MiB to fit the project's actual Supabase plan. Neither
-- ever looked at `billing_plans.storage_bytes` (0034) — so a Plus
-- subscriber, whose plan row promises 50 GB, has been enforced at the same
-- 150 MiB ceiling as a free account the whole time. That's the real bug:
-- not that the free number was too generous, but that paying for more
-- storage bought nothing.
--
-- Built on `my_plan_id()` (0031) rather than re-deriving the caller's plan,
-- for the same reason every other per-caller helper in this schema does that
-- — one place to be right.
--
-- Where this still matters after 0035: cloud media *backup* (the `media`
-- bucket) already requires a paid plan outright for a free account — this
-- function is never reached for that bucket on the free tier, 0035's plan
-- check refuses the upload first. It's still the live ceiling for (a) a
-- Plus account's media backup, which was silently capped at 150 MiB instead
-- of the promised 50 GB until this migration, and (b) shared albums (0028),
-- which every plan can use and bills against this same number — that's the
-- one place a free account's own byte ceiling still applies, hence 50 MB.

create or replace function public.media_quota_bytes()
returns bigint
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    (select bp.storage_bytes from public.billing_plans bp where bp.id = public.my_plan_id()),
    -- Defensive only: my_plan_id() already falls back to 'free', and 'free'
    -- is seeded below — this is reachable only if that row is ever deleted.
    52428800 -- 50 MB
  );
$$;

revoke all on function public.media_quota_bytes() from public, anon;
grant execute on function public.media_quota_bytes() to authenticated;

-- Bring the seeded free plan's row in line with the number above, so the
-- fallback and the real lookup can never disagree.
update public.billing_plans
   set storage_bytes = 52428800, -- 50 MB
       updated_at = (extract(epoch from now()) * 1000)::bigint
 where id = 'free';
