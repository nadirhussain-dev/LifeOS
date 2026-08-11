-- 0034 — Pricing, moved off a hardcoded client array and onto the server.
--
-- `STORAGE_PLANS` (features/billing/config/plans.ts) has been a fixed TS
-- array since it was written: three plans, fixed prices, fixed storage —
-- changing any of it meant a code change and a release. This table is now
-- the source of truth; the client array becomes the offline/error fallback
-- (see plans.ts's updated header) rather than the only copy.
--
-- No write policy, on purpose — matches how every other operator-touched
-- table in this schema works (`admins`, `module_flags`, `account_status`):
-- mutations go through audited RPCs (`admin_upsert_plan`,
-- `admin_set_plan_active`), never a raw client `.update()`, so a price
-- change is exactly as accountable as a module being switched off is.

-- ===========================================================================
-- 1. TABLE
-- ===========================================================================

create table if not exists public.billing_plans (
  id text primary key,
  name text not null,
  storage_bytes bigint not null,
  price_cents integer not null,
  currency text not null default 'usd',
  period text not null check (period in ('free', 'month', 'year')),
  badge text,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at bigint not null,
  updated_at bigint not null
);

alter table public.billing_plans enable row level security;

-- Live plans are ordinary reference data — every signed-in account needs to
-- see them to choose one. An admin additionally sees archived plans, because
-- managing them means being able to find the ones that are hidden.
create policy "billing_plans_read" on public.billing_plans
  for select using (active or public.is_admin());

-- ===========================================================================
-- 2. SEED — the three plans that were, until now, the entire client array.
-- Day-one behaviour is unchanged; an admin can edit these from the console
-- from the moment this migration runs.
-- ===========================================================================

insert into public.billing_plans
  (id, name, storage_bytes, price_cents, currency, period, badge, sort_order, active, created_at, updated_at)
values
  ('free', 'Free', 157286400, 0, 'usd', 'free', null, 0, true,
    (extract(epoch from now()) * 1000)::bigint, (extract(epoch from now()) * 1000)::bigint),
  ('plus_monthly', 'Plus', 53687091200, 499, 'usd', 'month', null, 1, true,
    (extract(epoch from now()) * 1000)::bigint, (extract(epoch from now()) * 1000)::bigint),
  ('plus_yearly', 'Plus', 53687091200, 3999, 'usd', 'year', 'best_value', 2, true,
    (extract(epoch from now()) * 1000)::bigint, (extract(epoch from now()) * 1000)::bigint)
on conflict (id) do nothing;

-- ===========================================================================
-- 3. ADMIN RPCS
-- ===========================================================================

create or replace function public.admin_upsert_plan(
  p_id text,
  p_name text,
  p_storage_bytes bigint,
  p_price_cents integer,
  p_currency text,
  p_period text,
  p_badge text,
  p_sort_order integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not an administrator' using errcode = 'insufficient_privilege';
  end if;
  if p_period not in ('free', 'month', 'year') then
    raise exception 'invalid period' using errcode = 'invalid_parameter_value';
  end if;

  insert into public.billing_plans
    (id, name, storage_bytes, price_cents, currency, period, badge, sort_order, active, created_at, updated_at)
  values
    (p_id, p_name, p_storage_bytes, p_price_cents, coalesce(p_currency, 'usd'), p_period, p_badge,
     coalesce(p_sort_order, 0), true, (extract(epoch from now()) * 1000)::bigint,
     (extract(epoch from now()) * 1000)::bigint)
  on conflict (id) do update
    set name = excluded.name,
        storage_bytes = excluded.storage_bytes,
        price_cents = excluded.price_cents,
        currency = excluded.currency,
        period = excluded.period,
        badge = excluded.badge,
        sort_order = excluded.sort_order,
        updated_at = excluded.updated_at;

  insert into public.admin_audit_log (actor, action, target_user, detail)
  values (
    auth.uid(), 'upsert_plan', null,
    jsonb_build_object('id', p_id, 'price_cents', p_price_cents, 'storage_bytes', p_storage_bytes)
  );
end;
$$;

-- Archive/restore rather than delete — same discipline as every soft-delete
-- elsewhere in this schema. An archived plan stops being offered to anyone
-- choosing a plan but stays intact for whoever is already on it.
create or replace function public.admin_set_plan_active(p_id text, p_active boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not an administrator' using errcode = 'insufficient_privilege';
  end if;

  update public.billing_plans
     set active = p_active,
         updated_at = (extract(epoch from now()) * 1000)::bigint
   where id = p_id;

  insert into public.admin_audit_log (actor, action, target_user, detail)
  values (auth.uid(), 'set_plan_active', null, jsonb_build_object('id', p_id, 'active', p_active));
end;
$$;

revoke all on function public.admin_upsert_plan(text, text, bigint, integer, text, text, text, integer)
  from public, anon;
revoke all on function public.admin_set_plan_active(text, boolean) from public, anon;
grant execute on function public.admin_upsert_plan(text, text, bigint, integer, text, text, text, integer)
  to authenticated;
grant execute on function public.admin_set_plan_active(text, boolean) to authenticated;

-- ===========================================================================
-- 4. `profiles.plan_id` becomes a real reference to this table, not a
-- hardcoded three-value list.
--
-- 0031 wrote `plan_id` as `check (plan_id in ('free','plus_monthly',
-- 'plus_yearly'))` because there was nowhere else for the valid set to live.
-- Now there is: an admin adding a fourth plan through `admin_upsert_plan`
-- above must result in something a user can actually be assigned to, or
-- "add pricing" would be a screen that creates plans nobody can subscribe
-- to. Safe to swap in one statement — every existing `plan_id` value was
-- already constrained to the three ids this table was just seeded with, so
-- the new foreign key is satisfied by construction, for every row, before
-- it is added.
-- ===========================================================================

alter table public.profiles
  drop constraint if exists profiles_plan_id_check;

alter table public.profiles
  add constraint profiles_plan_id_fkey foreign key (plan_id) references public.billing_plans(id);

-- Re-validates against the real table instead of a hardcoded list, and
-- refuses an archived plan — the free-standing three-way check this
-- replaced could never have known "and it must still be offered."
create or replace function public.set_my_plan(p_plan_id text, p_renews_at bigint)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not exists (select 1 from public.billing_plans where id = p_plan_id and active) then
    raise exception 'unknown plan %', p_plan_id using errcode = '22023';
  end if;

  update public.profiles
     set plan_id = p_plan_id,
         plan_renews_at = p_renews_at,
         updated_at = extract(epoch from now())::bigint * 1000
   where id = (select auth.uid());
end;
$$;
