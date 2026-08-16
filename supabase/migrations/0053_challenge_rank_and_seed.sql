-- ---------------------------------------------------------------------------
-- 0050 — Two small things 0048 should have done, and one it could not.
--
-- ## 1. The switch, actually seeded off
--
-- 0048's header, the operator screen and three separate comments all say the
-- challenge is "seeded disabled". None of them seeded it. `module_flags` treats
-- an absent row as ENABLED — 0011's rule 1, deliberately, so a new module ships
-- working rather than waiting on DDL — which meant the programme would have
-- switched itself on for every account the moment these migrations were
-- applied.
--
-- That is the exact failure the comments were warning about, so the fix is a
-- row rather than another comment. `on conflict do nothing` because an operator
-- who has already turned it on must not have it turned back off by a re-run.
--
-- ## 2. Where somebody stands
--
-- `challenge_rank` answers "you are in the top N% of everyone who started",
-- which is the cheapest motivational line available: one aggregate, no new
-- table, and it reframes a long solitary climb as a contest somebody is
-- currently winning.
--
-- It has to be a function rather than a query because the honest version needs
-- to see every enrolment in the season, and 0048's RLS — correctly — lets an
-- account see only its own. So it runs SECURITY DEFINER, reads the whole
-- cohort, and returns **one number about the caller**. There is no argument to
-- point it at anybody else.
-- ---------------------------------------------------------------------------

insert into public.module_flags (module, enabled, message)
values ('rewards', false, null)
on conflict (module) do nothing;

/**
 * The caller's standing in their own season.
 *
 * `percentile` is the share of runs at or below the caller's progress, so a
 * higher number is better and "top N%" is `100 - percentile`. Ties count as
 * "at or below" on purpose: three people on day 40 are all ahead of everybody
 * on day 39, and splitting them apart would be precision the number does not
 * have.
 *
 * Returns nulls rather than raising when there is no run — the challenge screen
 * asks for this before it knows whether it will need it, and an error there
 * would surface as a failed query on a screen that is otherwise fine.
 */
create or replace function public.challenge_rank()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_uid uuid := auth.uid();
  v_season uuid;
  v_days integer;
  v_total integer;
  v_at_or_below integer;
begin
  if v_uid is null then
    return jsonb_build_object('ranked', false);
  end if;

  select e.season_id, e.qualified_days
    into v_season, v_days
    from public.challenge_enrollments e
   where e.user_id = v_uid and e.status = 'active';
  if not found then
    return jsonb_build_object('ranked', false);
  end if;

  select count(*), count(*) filter (where e.qualified_days <= v_days)
    into v_total, v_at_or_below
    from public.challenge_enrollments e
   where e.season_id = v_season;

  -- A cohort of one is not a ranking, and "top 100%" reads as a joke at the
  -- expense of the only person who has started.
  if v_total < 5 then
    return jsonb_build_object('ranked', false, 'cohort', v_total);
  end if;

  return jsonb_build_object(
    'ranked', true,
    'cohort', v_total,
    'topPercent', greatest(1, round((1 - v_at_or_below::numeric / v_total) * 100))
  );
end;
$$;

revoke all on function public.challenge_rank() from public, anon;
grant execute on function public.challenge_rank() to authenticated;
