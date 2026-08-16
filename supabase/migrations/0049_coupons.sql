-- 0048 — Coupons: owner-issued, time-boxed, cycle-limited discounts.
--
-- The one thing worth stating up front: Safepay Plans are fixed-price
-- objects (0047's header). There is no "apply a discount to this active
-- subscription" call — a discounted price is a *different* Plan. So a
-- coupon here does not touch price at checkout time the way a cart discount
-- would; it tells `safepay-checkout` which discounted Plan to create (once,
-- cached in `plan_coupon_variants`) and check the customer out against
-- instead of the base one, and it tells the webhook how many billing cycles
-- to honour that price for before asking the user to reconfirm at full price
-- (see `subscriptions.status = 'pending_renewal_confirmation'`, 0047).
--
-- Gated on `is_owner()`, not merely `is_admin()` — same reasoning 0033 gives
-- for roster mutations: this moves real money, so the worst a compromised
-- non-owner admin session can do is nothing to it at all.

-- ===========================================================================
-- 1. TABLES
-- ===========================================================================

create table if not exists public.coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  discount_type text not null check (discount_type in ('percent', 'fixed')),
  -- percent: 1-100. fixed: cents off, checked against price_cents below.
  discount_value integer not null check (discount_value > 0),
  duration_cycles integer not null check (duration_cycles >= 1),
  max_redemptions integer check (max_redemptions > 0),
  redemptions_count integer not null default 0,
  starts_at bigint not null,
  ends_at bigint,
  -- null = valid for any active plan.
  plan_ids text[],
  active boolean not null default true,
  created_at bigint not null,
  updated_at bigint not null,
  constraint coupons_percent_range
    check (discount_type <> 'percent' or discount_value <= 100)
);

alter table public.coupons enable row level security;
-- No select policy at all — codes must never be enumerable by listing this
-- table. The only ways to learn anything about a coupon are `validate_coupon`
-- (below, one code at a time, minimal fields) and the owner-only admin RPCs.

create table if not exists public.coupon_redemptions (
  id bigserial primary key,
  coupon_id uuid not null references public.coupons(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  subscription_id text not null,
  redeemed_at bigint not null,
  unique (coupon_id, user_id)
);

alter table public.coupon_redemptions enable row level security;
-- No policy — written only by safepay-webhook's service-role client, on the
-- first subscription.payment_succeeded for a coupon-attached subscription
-- (not on subscription.created: an abandoned checkout must not consume a
-- redemption).

-- The cache of discount-priced Safepay Plan objects, one per (base plan,
-- coupon) pair, created lazily on first checkout that needs it.
create table if not exists public.plan_coupon_variants (
  base_plan_id text not null references public.billing_plans(id),
  coupon_id uuid not null references public.coupons(id) on delete cascade,
  safepay_plan_id text not null,
  price_cents integer not null,
  created_at bigint not null,
  primary key (base_plan_id, coupon_id)
);

alter table public.plan_coupon_variants enable row level security;
-- No policy — internal to safepay-checkout's service-role client only.

-- Now that coupons exists, give 0047's subscriptions.coupon_id a real FK.
alter table public.subscriptions
  add constraint subscriptions_coupon_id_fkey
  foreign key (coupon_id) references public.coupons(id);

-- ===========================================================================
-- 2. VALIDATION — read-only, callable by any signed-in user at checkout time.
-- Deliberately narrow: never returns the row, never reveals a reason more
-- specific than what's listed below, so a client cannot use this to enumerate
-- who else has redeemed a code or probe unrelated coupons.
-- ===========================================================================

create or replace function public.validate_coupon(p_code text, p_plan_id text)
returns table (
  coupon_id uuid,
  discount_type text,
  discount_value integer,
  duration_cycles integer
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_uid uuid := (select auth.uid());
  v_coupon public.coupons;
  v_now bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  if v_uid is null then
    raise exception 'sign in first' using errcode = '28000';
  end if;

  select * into v_coupon from public.coupons c where c.code = upper(trim(p_code));

  if v_coupon.id is null or not v_coupon.active then
    raise exception 'unknown coupon code' using errcode = 'no_data_found';
  end if;
  if v_now < v_coupon.starts_at then
    raise exception 'this code is not active yet' using errcode = 'invalid_parameter_value';
  end if;
  if v_coupon.ends_at is not null and v_now > v_coupon.ends_at then
    raise exception 'this code has expired' using errcode = 'invalid_parameter_value';
  end if;
  if v_coupon.plan_ids is not null and not (p_plan_id = any(v_coupon.plan_ids)) then
    raise exception 'this code does not apply to that plan' using errcode = 'invalid_parameter_value';
  end if;
  if v_coupon.max_redemptions is not null and v_coupon.redemptions_count >= v_coupon.max_redemptions then
    raise exception 'this code has reached its redemption limit' using errcode = 'invalid_parameter_value';
  end if;
  if exists (
    select 1 from public.coupon_redemptions r
     where r.coupon_id = v_coupon.id and r.user_id = v_uid
  ) then
    raise exception 'you have already used this code' using errcode = 'invalid_parameter_value';
  end if;

  return query select v_coupon.id, v_coupon.discount_type, v_coupon.discount_value, v_coupon.duration_cycles;
end;
$$;

revoke all on function public.validate_coupon(text, text) from public, anon;
grant execute on function public.validate_coupon(text, text) to authenticated;

-- ===========================================================================
-- 3. ADMIN RPCS — owner-only, audited, same shape as admin_upsert_plan (0034).
-- ===========================================================================

create or replace function public.admin_create_coupon(
  p_code text,
  p_discount_type text,
  p_discount_value integer,
  p_duration_cycles integer,
  p_max_redemptions integer,
  p_starts_at bigint,
  p_ends_at bigint,
  p_plan_ids text[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_now bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  if not public.is_owner() then
    raise exception 'only the owner can manage coupons' using errcode = 'insufficient_privilege';
  end if;
  if p_discount_type not in ('percent', 'fixed') then
    raise exception 'invalid discount type' using errcode = 'invalid_parameter_value';
  end if;

  insert into public.coupons
    (code, discount_type, discount_value, duration_cycles, max_redemptions,
     starts_at, ends_at, plan_ids, active, created_at, updated_at)
  values
    (upper(trim(p_code)), p_discount_type, p_discount_value, p_duration_cycles,
     p_max_redemptions, coalesce(p_starts_at, v_now), p_ends_at, p_plan_ids, true, v_now, v_now)
  returning id into v_id;

  insert into public.admin_audit_log (actor, action, target_user, detail)
  values (
    auth.uid(), 'create_coupon', null,
    jsonb_build_object('coupon_id', v_id, 'code', upper(trim(p_code)), 'discount_type', p_discount_type)
  );

  return v_id;
end;
$$;

-- Edit/deactivate only — no hard delete, same archive-don't-erase discipline
-- as admin_set_plan_active (0034). A deactivated code stays intact for
-- reporting on who already redeemed it.
create or replace function public.admin_update_coupon(
  p_id uuid,
  p_active boolean,
  p_ends_at bigint,
  p_max_redemptions integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_owner() then
    raise exception 'only the owner can manage coupons' using errcode = 'insufficient_privilege';
  end if;

  update public.coupons
     set active = p_active,
         ends_at = p_ends_at,
         max_redemptions = p_max_redemptions,
         updated_at = (extract(epoch from now()) * 1000)::bigint
   where id = p_id;

  insert into public.admin_audit_log (actor, action, target_user, detail)
  values (auth.uid(), 'update_coupon', null, jsonb_build_object('coupon_id', p_id, 'active', p_active));
end;
$$;

create or replace function public.admin_list_coupons()
returns table (
  id uuid,
  code text,
  discount_type text,
  discount_value integer,
  duration_cycles integer,
  max_redemptions integer,
  redemptions_count integer,
  starts_at bigint,
  ends_at bigint,
  plan_ids text[],
  active boolean,
  created_at bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not public.is_owner() then
    raise exception 'only the owner can manage coupons' using errcode = 'insufficient_privilege';
  end if;

  return query
    select c.id, c.code, c.discount_type, c.discount_value, c.duration_cycles,
           c.max_redemptions, c.redemptions_count, c.starts_at, c.ends_at,
           c.plan_ids, c.active, c.created_at
      from public.coupons c
     order by c.created_at desc;
end;
$$;

revoke all on function public.admin_create_coupon(text, text, integer, integer, integer, bigint, bigint, text[])
  from public, anon;
revoke all on function public.admin_update_coupon(uuid, boolean, bigint, integer) from public, anon;
revoke all on function public.admin_list_coupons() from public, anon;
grant execute on function public.admin_create_coupon(text, text, integer, integer, integer, bigint, bigint, text[])
  to authenticated;
grant execute on function public.admin_update_coupon(uuid, boolean, bigint, integer) to authenticated;
grant execute on function public.admin_list_coupons() to authenticated;

-- ===========================================================================
-- 4. REDEMPTION COUNTER — called only by safepay-webhook's service-role
-- client, on the first subscription.payment_succeeded for a coupon-attached
-- subscription. The `where` clause is the entire race guard: two concurrent
-- webhook deliveries both attempting the last redemption of a limited code
-- can only ever result in one successful increment.
-- ===========================================================================

create or replace function public.increment_coupon_redemption(p_coupon_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.coupons
     set redemptions_count = redemptions_count + 1,
         updated_at = (extract(epoch from now()) * 1000)::bigint
   where id = p_coupon_id
     and (max_redemptions is null or redemptions_count < max_redemptions);
end;
$$;

-- Not granted to authenticated/anon at all — this is internal to the
-- webhook's service-role client, same "not for a client to call" posture as
-- staff_access_report (0018).
revoke all on function public.increment_coupon_redemption(uuid) from public, anon, authenticated;
grant execute on function public.increment_coupon_redemption(uuid) to service_role;
