// Supabase Edge Function: safepay-webhook
//
// The real backend of the subscriptions feature. Safepay never calls the app
// or gives a client anything to trust — every state change LifeOS acts on
// arrives here first. This is "the one place a real payment webhook would
// write to later" that 0031's own migration header predicted.
//
// No caller JWT exists for this request — it comes from Safepay, not a
// signed-in user — so every write below uses the service-role client
// directly, the same pattern ban-account/index.ts already uses for
// admin_audit_log, and profiles/subscriptions/coupons all have no client
// write policy for exactly this reason.
//
// NOTE — the exact field names read out of `payload` below (event id, type,
// and the subscription object's fields) are Safepay's documented but not
// fully confirmed webhook shape. Capture one real sandbox delivery and
// adjust `readEvent()` if any of these differ — nothing else in this file
// needs to change if they do.
//
// ## Freshness, separately from authenticity
//
// A signature is a statement about the bytes, not about the moment. A delivery
// captured off the wire — a proxy log, a mirrored request, an intermediary
// someone misconfigured — stays signature-valid forever, so whoever holds a
// copy can present it again at any time. `payment_events.id` already makes that
// replay a no-op, which is why it was never an exploitable double-charge, but
// "accepted and then ignored" is a weaker answer than "refused", and the log
// could not tell the two apart.
//
// So a delivery older than SAFEPAY_WEBHOOK_MAX_AGE_SECONDS is refused before it
// is recorded — five minutes by default, the same tolerance Stripe applies to
// its own timestamped signatures. See `readTimestamp` for the one caveat that
// matters (the field name is not confirmed) and 0064's header for the query that
// tells you whether it is safe to switch the strict mode on.
//
// Deploy:
//   supabase functions deploy safepay-webhook --no-verify-jwt
//   supabase secrets set SAFEPAY_WEBHOOK_SECRET=...
//   # optional, both have working defaults:
//   supabase secrets set SAFEPAY_WEBHOOK_MAX_AGE_SECONDS=300
//   supabase secrets set SAFEPAY_WEBHOOK_REQUIRE_TIMESTAMP=false
//
// `--no-verify-jwt` is required: Safepay's request carries no Supabase JWT
// at all, only its own X-SFPY-SIGNATURE header, which is what actually
// authenticates this request below.
//
// This file is Deno (URL imports) and is excluded from the app's tsconfig.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { optionalSecret } from '../_shared/env.ts';
import { safepayClient } from '../_shared/safepay.ts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Default tolerance between the timestamp in a delivery and when it arrives.
 *  Set SAFEPAY_WEBHOOK_MAX_AGE_SECONDS=0 to disable the check entirely. */
const DEFAULT_MAX_AGE_SECONDS = 300;

/**
 * How far into the FUTURE a timestamp may sit before it is nonsense rather than
 * clock skew. Separate from the max age because the two are not symmetrical: a
 * delivery from five minutes ago is ordinary, and one from five minutes in the
 * future means somebody's clock is wrong or the value is not a timestamp at all.
 */
const MAX_SKEW_MS = 60_000;

/** `optionalSecret` treats "" as unset — see _shared/env.ts for why that matters
 *  here specifically: `supabase secrets set --env-file` pushes blank keys, and
 *  `?? 300` on an empty string would leave the window at NaN. */
function maxAgeMs(): number {
  const raw = optionalSecret('SAFEPAY_WEBHOOK_MAX_AGE_SECONDS');
  if (raw === null) return DEFAULT_MAX_AGE_SECONDS * 1000;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    console.error('SAFEPAY_WEBHOOK_MAX_AGE_SECONDS is not a number — using the default', { raw });
    return DEFAULT_MAX_AGE_SECONDS * 1000;
  }
  return parsed * 1000;
}

/** Off by default: see `readTimestamp`. */
function requireTimestamp(): boolean {
  return (optionalSecret('SAFEPAY_WEBHOOK_REQUIRE_TIMESTAMP') ?? 'false').toLowerCase() === 'true';
}

/** Epoch-ms from seconds, milliseconds, or an ISO string — Safepay's own
 *  payloads already mix the first two (see `readEvent`'s period handling), so
 *  guessing by magnitude is the established approach in this file rather than a
 *  new one. Anything before 2001 in ms is read as seconds. */
function toEpochMs(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 1_000_000_000_000 ? value * 1000 : value;
  }
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return toEpochMs(numeric);
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return null;
}

/**
 * When Safepay says this delivery was made.
 *
 * Checked in the order it is most likely to be authoritative: a dedicated
 * header first (a header is per-delivery, so a retry carries a fresh one),
 * then the event's own creation time in the body.
 *
 * ## Why a missing timestamp is tolerated by default
 *
 * None of these names is confirmed against this merchant account — the same
 * caveat this file's header already states for every other field it reads. If
 * the real name differs, a strict check would refuse *every* delivery, which
 * turns a hardening measure into a total outage of subscription state: payments
 * would succeed at Safepay and nobody would be upgraded. So an undated delivery
 * is accepted, loudly, and 0064 records the NULL so the gap is countable.
 *
 * Set SAFEPAY_WEBHOOK_REQUIRE_TIMESTAMP=true once that count is zero.
 *
 * ## Why the inner `object` is deliberately NOT searched
 *
 * This is the trap in the whole design, and getting it wrong would be worse than
 * having no window at all.
 *
 * `readEvent` below reads the *subscription* out of `data.object`, and a
 * subscription object carries its own `created` — the date the subscription was
 * set up, which for any renewal is months ago. Searched as a fallback, that value
 * would be read as the delivery time, and every `payment_succeeded` for a
 * subscription older than five minutes — which is to say every renewal there
 * will ever be — would be refused as stale. Payments would keep succeeding at
 * Safepay while nobody's plan was ever extended.
 *
 * So only the ENVELOPE is searched: the top-level payload and its `data`
 * wrapper, which is where an event's own creation time lives (the same
 * distinction Stripe draws between `event.created` and `object.created`). A
 * missing envelope timestamp is answered with null and the tolerated path above,
 * never by reaching one level deeper for something that looks like a date.
 */
function readTimestamp(req: Request, payload: Record<string, unknown>): number | null {
  const headerNames = ['x-sfpy-timestamp', 'x-sfpy-signature-timestamp', 'x-safepay-timestamp'];
  for (const name of headerNames) {
    const parsed = toEpochMs(req.headers.get(name));
    if (parsed !== null) return parsed;
  }

  const data = payload.data as Record<string, unknown> | undefined;
  const envelopes = data ? [payload, data] : [payload];
  for (const source of envelopes) {
    for (const field of ['created', 'created_at', 'timestamp', 'event_time']) {
      const parsed = toEpochMs(source[field]);
      if (parsed !== null) return parsed;
    }
  }
  return null;
}

type ParsedEvent = {
  id: string;
  type: string;
  reference: string | null;
  subscriptionId: string | null;
  customerId: string | null;
  currentPeriodEnd: number | null;
};

/** Defensive extraction — see the file header for why the fallbacks exist. */
function readEvent(payload: Record<string, unknown>): ParsedEvent {
  const data = (payload.data as Record<string, unknown> | undefined) ?? payload;
  const obj = (data.object as Record<string, unknown> | undefined) ?? data;

  const periodEndRaw = obj.current_period_end ?? obj.next_billing_at ?? obj.period_end;
  const currentPeriodEnd =
    typeof periodEndRaw === 'number'
      ? periodEndRaw
      : typeof periodEndRaw === 'string' && !Number.isNaN(Date.parse(periodEndRaw))
        ? Date.parse(periodEndRaw)
        : null;

  return {
    id: String(payload.id ?? obj.id ?? ''),
    type: String(payload.type ?? ''),
    reference: (obj.reference as string | undefined) ?? null,
    subscriptionId:
      (obj.id as string | undefined) ?? (obj.subscription_id as string | undefined) ?? null,
    customerId: (obj.customer_id as string | undefined) ?? null,
    currentPeriodEnd,
  };
}

function periodEndFallback(period: string, from: number): number {
  const days = period === 'year' ? 365 : 30;
  return from + days * 86_400_000;
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  try {
    // Read the raw body once for both signature verification and parsing —
    // Safepay's signature is over the exact bytes sent, so anything that
    // re-serializes JSON before checking it would break verification.
    const rawBody = await req.text();

    const safepay = safepayClient();
    const verifyReq = new Request(req.url, { method: 'POST', headers: req.headers, body: rawBody });
    // The reason is logged rather than collapsed into the boolean. A thrown
    // verifier (a missing SAFEPAY_WEBHOOK_SECRET, an SDK change) and a genuinely
    // bad signature both produce this 401, and they need completely different
    // responses from whoever is reading the logs.
    const valid = await safepay.verify.webhook(verifyReq).catch((error: unknown) => {
      console.error('webhook signature verification threw', {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    });
    if (!valid) return json({ error: 'invalid signature' }, 401);

    const payload = JSON.parse(rawBody) as Record<string, unknown>;
    const event = readEvent(payload);
    if (!event.id || !event.type) return json({ error: 'unrecognized payload' }, 400);

    // Freshness, after authenticity and before anything is recorded. Refusing
    // deliberately does NOT write a payment_events row: doing so would consume
    // this event id and turn a later, legitimate retry of the same event into a
    // silent no-op — the exact failure that primary key exists to prevent.
    const signedAt = readTimestamp(req, payload);
    const window = maxAgeMs();
    const arrivedAt = Date.now();

    if (signedAt === null) {
      if (requireTimestamp()) {
        console.error('refusing an undated delivery — strict mode is on', { id: event.id });
        return json({ error: 'missing timestamp' }, 400);
      }
      console.error('accepting an undated delivery — readTimestamp() found no field it knows', {
        id: event.id,
        type: event.type,
      });
    } else if (window > 0) {
      const age = arrivedAt - signedAt;
      if (age > window) {
        console.error('refusing a stale delivery', { id: event.id, ageMs: age, windowMs: window });
        return json({ error: 'stale delivery', ageSeconds: Math.round(age / 1000) }, 400);
      }
      if (age < -MAX_SKEW_MS) {
        console.error('refusing a future-dated delivery', { id: event.id, ageMs: age });
        return json({ error: 'timestamp is in the future' }, 400);
      }
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(supabaseUrl, serviceKey);

    // Idempotency: a retried delivery is a no-op, not a double-processed
    // payment. The insert itself — not a preceding select — is the guard:
    // `payment_events.id` is the primary key (migration 0047), so this
    // either claims the event id or fails because a concurrent delivery
    // already has, with nothing in between where two requests could both
    // see "not yet recorded" and both fall through to process it. Safepay
    // retries on anything but a 200, so concurrent redeliveries of the same
    // event id are an expected case, not an edge case.
    const { error: insertError } = await admin.from('payment_events').insert({
      id: event.id,
      type: event.type,
      payload,
      received_at: arrivedAt,
      // 0064. NULL means readTimestamp() recognised nothing — counting those is
      // how you find out whether SAFEPAY_WEBHOOK_REQUIRE_TIMESTAMP can be
      // switched on, and `received_at - signed_at` is the real delivery lag to
      // check before anybody tightens the window.
      signed_at: signedAt,
    });
    if (insertError) {
      if (insertError.code === '23505') return json({ ok: true, replayed: true });
      return json({ error: insertError.message }, 500);
    }

    // The same instant the delivery was recorded at, not a second reading of the
    // clock: every row this event writes should agree about when it happened.
    const now = arrivedAt;

    if (event.type === 'subscription.created') {
      if (!event.reference || !event.subscriptionId) return json({ ok: true });

      // Claimed, not read. 0063's `claim_checkout_intent` stamps `consumed_at`
      // in the same statement that returns the row, with `where consumed_at is
      // null` — so an intent that has already converted returns nothing, and
      // safepay-checkout's "reuse a recent open intent" path can trust that an
      // open intent really is open. A plain select left every converted intent
      // looking reusable forever.
      const { data: claimed, error: claimError } = await admin.rpc('claim_checkout_intent', {
        p_reference: event.reference,
        p_now: now,
      });
      if (claimError) return json({ error: claimError.message }, 500);
      const intent = (Array.isArray(claimed) ? claimed[0] : claimed) as
        { user_id: string; plan_id: string; coupon_id: string | null } | undefined;
      if (!intent) return json({ ok: true, note: 'no open checkout_intent for this reference' });

      let cyclesRemaining: number | null = null;
      if (intent.coupon_id) {
        const { data: coupon } = await admin
          .from('coupons')
          .select('duration_cycles')
          .eq('id', intent.coupon_id)
          .maybeSingle();
        cyclesRemaining = coupon?.duration_cycles ?? null;
      }

      await admin.from('subscriptions').upsert({
        user_id: intent.user_id,
        safepay_subscription_id: event.subscriptionId,
        safepay_customer_id: event.customerId,
        plan_id: intent.plan_id,
        coupon_id: intent.coupon_id,
        cycles_remaining: cyclesRemaining,
        status: 'pending',
        created_at: now,
        updated_at: now,
      });
      return json({ ok: true });
    }

    if (event.type === 'subscription.payment_succeeded') {
      if (!event.subscriptionId) return json({ ok: true });

      const { data: sub } = await admin
        .from('subscriptions')
        .select('user_id, plan_id, coupon_id, cycles_remaining')
        .eq('safepay_subscription_id', event.subscriptionId)
        .maybeSingle();
      if (!sub) return json({ ok: true, note: 'no matching subscription' });

      const { data: plan } = await admin
        .from('billing_plans')
        .select('period')
        .eq('id', sub.plan_id)
        .maybeSingle();
      const periodEnd =
        event.currentPeriodEnd ?? periodEndFallback((plan?.period as string) ?? 'month', now);

      let cyclesRemaining = sub.cycles_remaining;
      let status: string = 'active';
      if (cyclesRemaining !== null) {
        cyclesRemaining = Math.max(0, cyclesRemaining - 1);
        if (cyclesRemaining === 0) status = 'pending_renewal_confirmation';
      }

      await admin
        .from('subscriptions')
        .update({
          status,
          current_period_end: periodEnd,
          cycles_remaining: cyclesRemaining,
          updated_at: now,
        })
        .eq('safepay_subscription_id', event.subscriptionId);

      // Finalize the coupon redemption on the FIRST successful payment only
      // — a checkout that never reaches a payment must not consume it, and a
      // renewal payment on cycle 2+ must not consume it again.
      //
      // Insert first, increment only if the insert actually claimed the row
      // — the reverse order (increment, then insert) let a failed or racing
      // insert leave the counter incremented with no redemption row to show
      // for it. `unique (coupon_id, user_id)` (migration 0048) is what makes
      // the insert itself the guard: two payment_succeeded events for the
      // same coupon+user can both attempt it, but only one can succeed, so
      // `increment_coupon_redemption` — which has its own race-safe
      // `where redemptions_count < max_redemptions` — only ever runs once
      // per genuine redemption.
      if (sub.coupon_id) {
        const { error: redemptionError } = await admin.from('coupon_redemptions').insert({
          coupon_id: sub.coupon_id,
          user_id: sub.user_id,
          subscription_id: event.subscriptionId,
          redeemed_at: now,
        });
        if (!redemptionError) {
          await admin.rpc('increment_coupon_redemption', { p_coupon_id: sub.coupon_id });
        } else if (redemptionError.code !== '23505') {
          // Anything but "already redeemed" is worth surfacing, but must not
          // fail the whole webhook — the subscription/profile writes above
          // already landed and Safepay still needs its 200.
          console.error('coupon redemption insert failed', redemptionError);
        }
      }

      // The write 0031's header predicted — this is what actually gates
      // 0032's plan-limited triggers now.
      await admin
        .from('profiles')
        .update({ plan_id: sub.plan_id, plan_renews_at: periodEnd, updated_at: now })
        .eq('id', sub.user_id);

      return json({ ok: true });
    }

    if (event.type === 'subscription.payment_failed') {
      if (!event.subscriptionId) return json({ ok: true });
      await admin
        .from('subscriptions')
        .update({ status: 'past_due', updated_at: now })
        .eq('safepay_subscription_id', event.subscriptionId);
      return json({ ok: true });
    }

    if (event.type === 'subscription.cancelled') {
      if (!event.subscriptionId) return json({ ok: true });
      const { data: sub } = await admin
        .from('subscriptions')
        .select('user_id')
        .eq('safepay_subscription_id', event.subscriptionId)
        .maybeSingle();

      await admin
        .from('subscriptions')
        .update({ status: 'cancelled', updated_at: now })
        .eq('safepay_subscription_id', event.subscriptionId);

      if (sub) {
        await admin
          .from('profiles')
          .update({ plan_id: 'free', plan_renews_at: null, updated_at: now })
          .eq('id', sub.user_id);
      }
      return json({ ok: true });
    }

    return json({ ok: true, note: 'unhandled event type' });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Unexpected error' }, 500);
  }
});
