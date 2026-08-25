-- Season status hands back the rung payouts it has been omitting.
--
-- 0071 gave `challenge_tiers` a `rewards` jsonb column and taught the ladder,
-- the trophy case and the milestone sheet to draw from it. It did not touch
-- `challenge_season_status()`, which builds its embedded `tiers` array field by
-- field with `jsonb_build_object` — so that array has silently been one column
-- short of the shape the client's `ChallengeTier` type promises ever since.
--
-- What that cost: the challenge screen prefers the `challenge_tiers` table read
-- and falls back to this embedded ladder whenever that query has not answered
-- yet — every cold open, and permanently against a database still on pre-0071,
-- where the table read asks for a column that does not exist and only ever
-- errors. `MilestoneSheet` is mounted unconditionally on that screen (`visible`
-- controls the `Modal`, not whether the component body runs), so it reached
-- `tier.rewards.some(...)` on a rung with no `rewards` and threw. The throw
-- reached the root error boundary, and opening the module showed "Something
-- went wrong / Reload" instead of the streak.
--
-- The client no longer depends on this being right — `normalizeTier` in
-- features/challenge/hooks/use-challenge.ts defaults the field on the way in,
-- because an installed app talks to whatever database it is pointed at and
-- cannot be fixed by a migration. But a fallback ladder that renders every rung
-- as paying nothing is still the wrong picture, and the locked rung showing the
-- badge it is holding is the single strongest argument for climbing (0071's
-- header). So the payload carries the field.
--
-- Everything else is unchanged from the 0065 definition, which is the one in
-- force. Reproduced whole because `create or replace function` has no way to
-- amend one statement inside a body.
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
             'rewardDescription', t.reward_description,
             -- The addition. Coalesced even though 0071 declares the column
             -- `not null default '[]'`, because this function is also what a
             -- freshly restored or partially migrated database answers with,
             -- and an embedded `null` here is the exact shape that broke the
             -- screen in the first place.
             'rewards', coalesce(t.rewards, '[]'::jsonb)
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
    'requireLiveWrites', s.require_live_writes,
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
