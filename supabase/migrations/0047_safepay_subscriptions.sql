-- 0047 — Where a real subscription actually lives.
--
-- 0031's header said `set_my_plan` was "the one place a real payment webhook
-- would write to later." This migration is that webhook's landing surface.
--
-- Safepay's own model (confirmed against its docs, not assumed) is: Plans are
-- fixed-price objects created server-side, a customer can only start a
-- subscription by going through Safepay Checkout, Safepay itself charges the
-- schedule (LifeOS never runs a billing cron), and every lifecycle event
-- arrives as a webhook (`subscription.created`, `.payment_succeeded`,
-- `.payment_failed`, `.cancelled`). So the two tables below exist purely to
-- give that webhook somewhere honest to write, and `payment_events` exists so
-- a retried delivery — Safepay retries on anything but a 200 — is a no-op
-- instead of a double-processed charge.
--
-- Neither table gets a client write policy, on purpose, the same posture
-- `admin_audit_log` (0010) already has: the only writer is the service-role
-- client inside `supabase/functions/safepay-webhook`, exactly the pattern
-- `ban-account/index.ts` already uses to write `admin_audit_log` directly
-- rather than through an RPC. A client that could write its own subscription
-- row could grant itself Plus for free.

-- ===========================================================================
-- 1. billing_plans gets a cache slot for the Safepay Plan it maps to.
-- ===========================================================================

alter table public.billing_plans
  add column if not exists safepay_plan_id text;

-- ===========================================================================
-- 2. SUBSCRIPTIONS — one row per account, mirroring Safepay's own state.
-- ===========================================================================

create table if not exists public.subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  safepay_subscription_id text not null unique,
  safepay_customer_id text,
  plan_id text not null references public.billing_plans(id),
  coupon_id uuid,
  -- null = no discount attached to this subscription. Decremented by the
  -- webhook on every subscription.payment_succeeded; see 0048 for the coupon
  -- this references (added after this table, so no FK yet — 0048 adds it).
  cycles_remaining integer,
  status text not null default 'pending'
    check (status in ('pending', 'active', 'past_due', 'pending_renewal_confirmation', 'cancelled')),
  current_period_end bigint,
  created_at bigint not null,
  updated_at bigint not null
);

alter table public.subscriptions enable row level security;

-- Read-only, own row. There is no write policy at all: every write is the
-- service-role client in safepay-webhook (bypasses RLS) or safepay-checkout
-- (same). A raw client `.update()` against this table is refused outright,
-- not merely unauthorized for most values — the same discipline 0031's own
-- header describes for `set_my_plan` versus a raw `profiles` update.
create policy "subscriptions_read_own" on public.subscriptions
  for select using (user_id = (select auth.uid()));

-- ===========================================================================
-- 3. PAYMENT_EVENTS — the idempotency log. Primary key is Safepay's own event
-- id, so `insert ... on conflict (id) do nothing` is the entire replay guard.
-- ===========================================================================

create table if not exists public.payment_events (
  id text primary key,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  received_at bigint not null
);

create index if not exists payment_events_received_idx
  on public.payment_events (received_at desc);

alter table public.payment_events enable row level security;
-- No policy — same "read it with the service role" posture as admin_audit_log.

-- ===========================================================================
-- 4. A per-user read of the subscription, for the app's own billing screen.
-- Thin on purpose: RLS already restricts the row to its owner, this just
-- gives the client a stable RPC name instead of a bare `.select()` — same
-- reasoning `my_plan_id()` (0031) gives for wrapping a one-row lookup.
-- ===========================================================================

create or replace function public.my_subscription()
returns table (
  safepay_subscription_id text,
  plan_id text,
  coupon_id uuid,
  cycles_remaining integer,
  status text,
  current_period_end bigint
)
language sql
security invoker
set search_path = public
stable
as $$
  select s.safepay_subscription_id, s.plan_id, s.coupon_id, s.cycles_remaining,
         s.status, s.current_period_end
    from public.subscriptions s
   where s.user_id = (select auth.uid());
$$;

revoke all on function public.my_subscription() from public, anon;
grant execute on function public.my_subscription() to authenticated;
