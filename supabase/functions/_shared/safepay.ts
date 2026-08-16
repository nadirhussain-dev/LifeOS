// Shared Safepay client for the three safepay-* edge functions.
//
// This file is Deno (URL imports) and is excluded from the app's tsconfig,
// same as every other file under supabase/functions/.
//
// Uses the official `@sfpy/node-sdk` for the two calls it documents with a
// confirmed, stable method signature (cross-referenced against both its
// GitHub README and its npm listing):
//
//   safepay.checkout.createSubscription({ planId, reference, cancelUrl, redirectUrl })
//   safepay.verify.webhook(request)
//
// `ensureSafepayPlan()` below is the one exception, and is flagged in the
// implementation plan as an open item: the SDK does not document a
// `plans.create` wrapper, so this calls the REST endpoint Safepay's own
// Subscriptions guide names directly (`POST /client/plans/v1/`) using the
// same api/secret keys. The exact request/response field names here should
// be confirmed against Safepay's live API reference or Postman collection
// for this merchant account before the first production deploy — if the
// shape differs, this is the only function that needs to change.
import Safepay from 'https://esm.sh/@sfpy/node-sdk';

export type SafepayEnv = 'sandbox' | 'production';

export function safepayClient() {
  const environment = (Deno.env.get('SAFEPAY_ENVIRONMENT') ?? 'sandbox') as SafepayEnv;
  const apiKey = Deno.env.get('SAFEPAY_API_KEY');
  const v1Secret = Deno.env.get('SAFEPAY_SECRET_KEY');
  const webhookSecret = Deno.env.get('SAFEPAY_WEBHOOK_SECRET');
  if (!apiKey || !v1Secret) {
    throw new Error('SAFEPAY_API_KEY / SAFEPAY_SECRET_KEY are not configured');
  }
  return new Safepay({ environment, apiKey, v1Secret, webhookSecret });
}

function apiBase(): string {
  const environment = Deno.env.get('SAFEPAY_ENVIRONMENT') ?? 'sandbox';
  return environment === 'production'
    ? 'https://api.getsafepay.com'
    : 'https://sandbox.api.getsafepay.com';
}

/** Billing period on a `billing_plans`/coupon row → Safepay's plan interval. */
export function toSafepayInterval(period: 'month' | 'year'): 'MONTH' | 'YEAR' {
  return period === 'year' ? 'YEAR' : 'MONTH';
}

/**
 * Creates a Safepay Plan and returns its id. Called only when a
 * `billing_plans.safepay_plan_id` (or `plan_coupon_variants.safepay_plan_id`)
 * cache slot is empty — see the header above for why this is a raw REST call
 * rather than an SDK method, and the one place to fix if Safepay's actual
 * request/response shape turns out to differ from what's implemented here.
 */
export async function createSafepayPlan(input: {
  amountCents: number;
  currency: string;
  interval: 'MONTH' | 'YEAR';
  name: string;
}): Promise<string> {
  const apiKey = Deno.env.get('SAFEPAY_API_KEY');
  const secretKey = Deno.env.get('SAFEPAY_SECRET_KEY');
  if (!apiKey || !secretKey) {
    throw new Error('SAFEPAY_API_KEY / SAFEPAY_SECRET_KEY are not configured');
  }

  const res = await fetch(`${apiBase()}/client/plans/v1/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-SFPY-MERCHANT-SECRET': secretKey,
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      name: input.name,
      amount: String(Math.round(input.amountCents / 100)),
      currency: input.currency.toUpperCase(),
      interval: input.interval,
      interval_count: 1,
    }),
  });

  if (!res.ok) {
    throw new Error(`Safepay plan creation failed (${res.status}): ${await res.text()}`);
  }

  const body = (await res.json()) as Record<string, unknown>;
  const data = (body.data ?? body) as Record<string, unknown>;
  const planId = (data.id ?? data.token ?? data.plan_id) as string | undefined;
  if (!planId) {
    throw new Error(`Safepay plan creation returned no id: ${JSON.stringify(body)}`);
  }
  return planId;
}
