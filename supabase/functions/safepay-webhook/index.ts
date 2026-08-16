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
// Deploy:
//   supabase functions deploy safepay-webhook --no-verify-jwt
//   supabase secrets set SAFEPAY_WEBHOOK_SECRET=...
//
// `--no-verify-jwt` is required: Safepay's request carries no Supabase JWT
// at all, only its own X-SFPY-SIGNATURE header, which is what actually
// authenticates this request below.
//
// This file is Deno (URL imports) and is excluded from the app's tsconfig.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { safepayClient } from '../_shared/safepay.ts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

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
    const valid = await safepay.verify.webhook(verifyReq).catch(() => false);
    if (!valid) return json({ error: 'invalid signature' }, 401);

    const payload = JSON.parse(rawBody) as Record<string, unknown>;
    const event = readEvent(payload);
    if (!event.id || !event.type) return json({ error: 'unrecognized payload' }, 400);

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
    const { error: insertError } = await admin
      .from('payment_events')
      .insert({ id: event.id, type: event.type, payload, received_at: Date.now() });
    if (insertError) {
      if (insertError.code === '23505') return json({ ok: true, replayed: true });
      return json({ error: insertError.message }, 500);
    }

    const now = Date.now();

    if (event.type === 'subscription.created') {
      if (!event.reference || !event.subscriptionId) return json({ ok: true });

      const { data: intent } = await admin
        .from('checkout_intents')
        .select('user_id, plan_id, coupon_id')
        .eq('reference', event.reference)
        .maybeSingle();
      if (!intent) return json({ ok: true, note: 'no matching checkout_intent' });

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
      // for it. `unique (coupon_id, user_id)` (migration 0049) is what makes
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
