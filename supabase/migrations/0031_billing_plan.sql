-- 0031 — Where an account's plan actually lives.
--
-- The mock billing store (features/billing/store/billing-store.ts) used to
-- keep "which plan you're on" purely in local AsyncStorage. That was fine
-- for a screen that only ever rendered it back to the same device, but it
-- cannot be the source of truth for anything that has to be *enforced* —
-- two devices signed into the same account would disagree, and every
-- principle this codebase already applies to quotas ("the client's own
-- check exists to give a good error message, not to be the limit" —
-- 0026's header) says the limit itself has to live where a client can't
-- edit its way past it.
--
-- This migration makes the plan a column on `profiles`, still entirely
-- mock (nothing here processes a payment), but now:
--   1. the same for every device signed into an account,
--   2. the thing 0032's plan-gated triggers actually check, and
--   3. the one place a real payment webhook would write to later — through
--      `set_my_plan`, not a raw client update, even though `profiles_own`
--      (0001) would technically allow one.

alter table public.profiles
  add column if not exists plan_id text not null default 'free'
    check (plan_id in ('free', 'plus_monthly', 'plus_yearly')),
  add column if not exists plan_renews_at bigint;

-- Hoisted, STABLE, SECURITY DEFINER — same shape as every other per-caller
-- helper in this codebase (my_album_ids, is_shared_album_owner, ...), so a
-- trigger that needs "is the current caller on a paid plan" doesn't pay a
-- per-row cost to ask.
create or replace function public.my_plan_id()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    (select p.plan_id from public.profiles p where p.id = (select auth.uid())),
    'free'
  );
$$;

revoke all on function public.my_plan_id() from public, anon;
grant execute on function public.my_plan_id() to authenticated;

-- The mock "subscribe" endpoint. SECURITY INVOKER is enough — `profiles_own`
-- already restricts a write to the caller's own row — but this exists as a
-- named RPC rather than a bare client `.update()` so there is exactly one
-- place a real payment integration replaces later, and so the plan id is
-- validated against the same three values the column's own check enforces
-- (belt and suspenders: a bad value fails here with a clear error instead
-- of a raw constraint-violation code).
create or replace function public.set_my_plan(p_plan_id text, p_renews_at bigint)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if p_plan_id not in ('free', 'plus_monthly', 'plus_yearly') then
    raise exception 'unknown plan %', p_plan_id using errcode = '22023';
  end if;

  update public.profiles
     set plan_id = p_plan_id,
         plan_renews_at = p_renews_at,
         updated_at = extract(epoch from now())::bigint * 1000
   where id = (select auth.uid());
end;
$$;

revoke all on function public.set_my_plan(text, bigint) from public, anon;
grant execute on function public.set_my_plan(text, bigint) to authenticated;
