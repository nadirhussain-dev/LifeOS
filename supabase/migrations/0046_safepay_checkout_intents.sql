-- 0046 — The attribution link between a checkout and a webhook.
--
-- Confirmed against Safepay's own Node SDK (`checkout.createSubscription`):
-- the only pass-through field a subscription checkout accepts is a single
-- opaque `reference` string, not a metadata object. Safepay's
-- `subscription.created` webhook echoes it back, but LifeOS still needs
-- somewhere to look up what that reference actually meant — which user
-- started this checkout, against which base plan, with which coupon (if
-- any) — since the webhook is the first time Safepay tells us the resulting
-- `safepay_subscription_id`.
--
-- `safepay-checkout` (service-role client) inserts a row here right before
-- minting the checkout URL; `safepay-webhook` (service-role client) reads it
-- by `reference` on `subscription.created` and never needs it again. Kept
-- rather than deleted after use — same "the record outlives the action"
-- instinct as every audit table in this schema — so an abandoned checkout
-- that never converts is still visible if someone asks "did this user ever
-- try to subscribe."

create table if not exists public.checkout_intents (
  reference uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id text not null references public.billing_plans(id),
  coupon_id uuid references public.coupons(id),
  created_at bigint not null
);

create index if not exists checkout_intents_user_idx on public.checkout_intents (user_id);

alter table public.checkout_intents enable row level security;
-- No policy — written and read only by the service-role clients in
-- safepay-checkout and safepay-webhook, same posture as payment_events.
