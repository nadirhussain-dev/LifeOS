-- 0063 — Make starting a checkout idempotent.
--
-- ## The gap this closes
--
-- `safepay-checkout` was the one function in this feature with no replay guard,
-- sitting directly in front of the two things in it that cost money. Every call
-- inserted a fresh `checkout_intents` row (0049) and, on a coupon path whose
-- variant was not cached yet, created a **new Safepay Plan object** at the
-- provider. A double-tapped subscribe button, or a client retrying a request
-- whose response was lost, therefore left two intents and — on the first
-- checkout for any given coupon — two Plans, one of them orphaned at Safepay
-- forever with no local row naming it.
--
-- That is the same class of bug `payment_events.id` (0047) already solves for
-- the webhook, and the fix is the same shape: a uniquely-constrained insert
-- whose failure IS the guard, rather than a select that asks first.
--
-- ## Two layers, because clients forget keys
--
--  1. **`idempotency_key`** — the client's own key, sent as an
--     `Idempotency-Key` header. Unique per user, so a retry with the same key
--     cannot create a second intent; the winner's `checkout_url` is replayed
--     back instead. This is the real guard.
--  2. **Reuse of a recent intent** — for a caller that sends no key at all
--     (every build shipped before this migration). A still-fresh, unconsumed
--     intent for the same user + plan + coupon is handed back rather than
--     duplicated, which is what actually closes the double-tap.
--
-- Layer 2 alone would be wrong as the only guard — "same plan within N minutes"
-- is a heuristic, and a user legitimately restarting an abandoned checkout gets
-- the earlier URL — but as a floor under layer 1 it is strictly better than
-- what it replaces, which was nothing.
--
-- ## Why `checkout_url` is stored
--
-- A replay has to answer with something, and the only useful answer is the URL
-- the first call already minted. Storing it makes the intent the record of what
-- the user was actually sent to, which is also the first thing anyone
-- debugging "they say they paid" wants to see. It is not a secret: it is a
-- Safepay-hosted checkout page for a single subscription, the user was already
-- redirected to it, and the table has no client read policy regardless.
--
-- ## Why nothing is deleted
--
-- Same instinct 0049's own header states: the record outlives the action. A
-- consumed intent is marked, not removed, so an abandoned checkout stays
-- visible.

-- ===========================================================================
-- 1. checkout_intents grows the columns a replay needs.
-- ===========================================================================

alter table public.checkout_intents
  add column if not exists idempotency_key text,
  add column if not exists checkout_url text,
  -- Stamped by safepay-webhook when `subscription.created` claims this intent,
  -- so layer 2 above never hands back a URL for a checkout that already
  -- converted. Null means "still open".
  add column if not exists consumed_at bigint,
  add column if not exists updated_at bigint;

-- Unique *per user*, not globally: an idempotency key is scoped to whoever
-- issued it, and a global constraint would let one account's key collide with
-- another's and refuse a legitimate checkout. Partial, so the rows written by
-- clients that send no key at all do not all collide on NULL — which in
-- Postgres they would not anyway, but stating it in the index means the
-- intent survives someone "simplifying" it to a plain unique constraint.
create unique index if not exists checkout_intents_idempotency_idx
  on public.checkout_intents (user_id, idempotency_key)
  where idempotency_key is not null;

-- Supports layer 2's lookup: the newest open intent for this user. Kept narrow
-- — plan and coupon are compared after the fetch rather than indexed, because
-- a user has single-digit intents and `checkout_intents_user_idx` (0049) alone
-- would still make this a sort.
create index if not exists checkout_intents_open_idx
  on public.checkout_intents (user_id, created_at desc)
  where consumed_at is null;

-- ===========================================================================
-- 2. Claiming an intent, atomically.
-- ===========================================================================
--
-- Used by safepay-webhook on `subscription.created`. The `where consumed_at is
-- null` in the UPDATE is what makes this a claim rather than a read: two
-- concurrent deliveries of the same event (which `payment_events` already makes
-- rare, not impossible, since the second is refused before reaching here) can
-- both call it, and only one gets a row back.
--
-- service_role only. The webhook has no caller JWT at all — that is why it
-- deploys `--no-verify-jwt` — so this is the one function in the pair that
-- cannot read auth.uid(), and a client able to claim its own intent could
-- attach an arbitrary plan to itself.
create or replace function public.claim_checkout_intent(
  p_reference uuid,
  p_now bigint
)
returns table (
  user_id uuid,
  plan_id text,
  coupon_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.checkout_intents ci
     set consumed_at = p_now,
         updated_at = p_now
   where ci.reference = p_reference
     and ci.consumed_at is null
  returning ci.user_id, ci.plan_id, ci.coupon_id;
end;
$$;

revoke all on function public.claim_checkout_intent(uuid, bigint) from public, anon, authenticated;
grant execute on function public.claim_checkout_intent(uuid, bigint) to service_role;

-- ===========================================================================
-- 3. Backfill.
-- ===========================================================================
--
-- Every intent that predates this migration is treated as already consumed.
-- The alternative — leaving them open — would have the first post-deploy
-- checkout replay a `checkout_url` column that is NULL for all of them, and
-- `updated_at` sorting behind rows that have one. There is nothing to lose:
-- an intent from before this deploy either converted (and its subscription
-- exists) or was abandoned weeks ago.
update public.checkout_intents
   set consumed_at = created_at,
       updated_at = created_at
 where consumed_at is null
   and checkout_url is null;
