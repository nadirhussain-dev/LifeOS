// Supabase Edge Function: safepay-checkout
//
// Starts a real, recurring Safepay subscription. Replaces the mock
// `set_my_plan` write `useSubscribeMutation` used to make directly — see
// 0031's own header, which named this exact function as the thing that
// would eventually exist.
//
// Never trusts the request body for who the caller is: identifies them from
// their own JWT, the same way send-invite and ban-account already do.
//
// ## Idempotent, because both things it does cost money
//
// This function creates a `checkout_intents` row and, the first time any given
// coupon is used, a **Safepay Plan object at the provider**. Neither is
// reversible from here, so a double-tapped subscribe button or a retry of a
// request whose response was lost used to leave two intents and an orphaned
// Plan nobody had a row for.
//
// The guard is 0063's `unique (user_id, idempotency_key)` and it is claimed
// BEFORE the expensive work, not after — the same "the insert itself is the
// guard, not a preceding select" discipline safepay-webhook uses for
// `payment_events.id`. Ordering is the whole of it: with the claim after plan
// resolution, two concurrent calls would both create a Plan and only then
// discover one of them was redundant.
//
// Clients should send an `Idempotency-Key` header. One that doesn't gets a
// synthesized key instead (see `resolveIdempotencyKey`), so the protection does
// not depend on the app being updated first.
//
// Deploy:
//   supabase functions deploy safepay-checkout
//   supabase secrets set SAFEPAY_API_KEY=... SAFEPAY_SECRET_KEY=... SAFEPAY_ENVIRONMENT=sandbox
//
// This file is Deno (URL imports) and is excluded from the app's tsconfig.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { discountedCents } from '../_shared/money.ts';
import { consumeRateLimit, tooManyRequests } from '../_shared/rate-limit.ts';
import { createSafepayPlan, safepayClient, toSafepayRecurrence } from '../_shared/safepay.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  // `idempotency-key` added for 0063. A browser preflight drops any header it
  // was not told about, so without it the web build would send its key and the
  // function would never see it — the protection silently downgrading to the
  // synthesized fallback on exactly the platform that preflights.
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, idempotency-key',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

type Body = { planId?: string; couponCode?: string; idempotencyKey?: string };

/** Postgres' unique-violation SQLSTATE. The `checkout_intents` insert below
 *  expects it as a normal outcome, not an error. */
const UNIQUE_VIOLATION = '23505';

/**
 * How long an unconsumed intent may be handed back instead of a new one.
 *
 * This is the belt to the idempotency key's braces, and it is what actually
 * catches the human case: tapping subscribe, backing out of the Safepay page,
 * and tapping it again. Short on purpose — a Safepay-hosted checkout page is
 * only useful while the session behind it is live, and replaying an hour-old
 * URL would trade a duplicate intent for a dead link, which is worse.
 */
const INTENT_REUSE_MS = 10 * 60 * 1000;

/**
 * Shape a key has to have to be stored. Deliberately permissive about *what*
 * the key is (a uuid, a request id, a hash — the client's business) and strict
 * about length, since it lands in a unique index.
 */
const KEY_PATTERN = /^[A-Za-z0-9_.:-]{8,200}$/;

/**
 * The key this request is claimed under.
 *
 * A client-supplied key is used as-is and prefixed so it can never collide with
 * a synthesized one. A client that sends none gets a key derived from what it
 * is asking for plus the current minute — which is not a real idempotency key
 * and is not pretending to be one. What it buys is the case that actually
 * happens: two taps a few hundred milliseconds apart resolve to the same key,
 * so the unique index refuses the second before it can create anything. Two
 * taps that straddle a minute boundary do not, and fall through to the
 * `INTENT_REUSE_MS` check instead.
 *
 * Returns null for a malformed client key. That is a 400 rather than a silent
 * fall-back to the synthesized form, because a client that believes it sent a
 * key and is quietly not protected by it is the worst of the three outcomes.
 */
function resolveIdempotencyKey(
  req: Request,
  body: Body,
  parts: { userId: string; planId: string; couponId: string | null; now: number },
): { key: string; supplied: boolean } | null {
  const supplied = (req.headers.get('Idempotency-Key') ?? body.idempotencyKey ?? '').trim();
  if (supplied) {
    return KEY_PATTERN.test(supplied) ? { key: `c:${supplied}`, supplied: true } : null;
  }
  const minute = Math.floor(parts.now / 60_000);
  return {
    key: `auto:${parts.planId}:${parts.couponId ?? 'none'}:${minute}`,
    supplied: false,
  };
}

/**
 * The recurrence fields `createSafepayPlan` needs, as one spreadable object.
 *
 * Both call sites below build the same argument, and the failure they are being
 * protected from is passing an interval without its count — which for a
 * quarterly plan means billing monthly at the quarterly price. Spreading one
 * helper makes the pair inseparable; `toSafepayRecurrence` throws rather than
 * guessing at a period it has not been taught.
 */
function recurrenceOf(period: string): { interval: 'MONTH' | 'YEAR'; intervalCount: number } {
  const { interval, count } = toSafepayRecurrence(period);
  return { interval, intervalCount: count };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'unauthorized' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // Runs every check as the caller — RLS and validate_coupon() decide what
    // they're allowed to see, the same discipline ban-account uses for
    // is_admin().
    const asCaller = createClient(supabaseUrl, serviceKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await asCaller.auth.getUser();
    if (userError || !userData.user) return json({ error: 'unauthorized' }, 401);
    const user = userData.user;

    // Ten an hour. The idempotency guard below bounds *duplicates* of one
    // intent; this bounds how many distinct intents one account can open, which
    // is the other half — a script walking plan ids would otherwise mint a
    // Safepay Plan per coupon variant with a fresh key each time.
    const budget = await consumeRateLimit(asCaller, 'edge_safepay_checkout');
    if (!budget.allowed) return tooManyRequests(budget, corsHeaders);

    const body = (await req.json().catch(() => null)) as Body | null;
    if (!body?.planId) return json({ error: 'planId is required' }, 400);

    const { data: plan, error: planError } = await asCaller
      .from('billing_plans')
      .select('id, name, price_cents, currency, period, active, safepay_plan_id')
      .eq('id', body.planId)
      .maybeSingle();
    if (planError) return json({ error: planError.message }, 500);
    if (!plan || !plan.active || plan.period === 'free') {
      return json({ error: 'unknown or unavailable plan' }, 400);
    }

    // ---------------------------------------------------------------------
    // 1. Resolve the coupon. Read-only (`validate_coupon` is 0048's narrow,
    //    side-effect-free check) and therefore safe to do before the claim —
    //    which it has to be, since the coupon is part of what identifies the
    //    checkout being claimed.
    // ---------------------------------------------------------------------
    let couponId: string | null = null;
    let discountedPriceCents: number | null = null;

    if (body.couponCode) {
      const { data: validated, error: couponError } = await asCaller.rpc('validate_coupon', {
        p_code: body.couponCode,
        p_plan_id: plan.id,
      });
      if (couponError) return json({ error: couponError.message }, 400);
      const coupon = (validated ?? [])[0] as
        | {
            coupon_id: string;
            discount_type: string;
            discount_value: number;
            duration_cycles: number;
          }
        | undefined;
      if (!coupon) return json({ error: 'invalid coupon' }, 400);
      couponId = coupon.coupon_id;

      // Shared with the client's coupon preview (money.ts) so the number
      // somebody is shown before subscribing and the number they are charged
      // cannot drift.
      discountedPriceCents = discountedCents(
        plan.price_cents as number,
        coupon.discount_type as 'percent' | 'fixed',
        coupon.discount_value,
      );
    }

    const now = Date.now();
    const idempotency = resolveIdempotencyKey(req, body, {
      userId: user.id,
      planId: plan.id as string,
      couponId,
      now,
    });
    if (!idempotency) {
      return json(
        {
          error:
            'Idempotency-Key must be 8-200 characters of letters, digits, or _.:- — ' +
            'omit the header entirely to fall back to the server-derived key',
        },
        400,
      );
    }

    // service-role client for everything past this point: billing_plans,
    // plan_coupon_variants and checkout_intents have no client write policy
    // (0034/0048/0049's own headers), same as every other admin-owned table in
    // this schema.
    const admin = createClient(supabaseUrl, serviceKey);

    /** Replay: the URL a previous call already minted for this same intent. */
    const replay = (reference: string, checkoutUrl: string) =>
      json({ ok: true, checkoutUrl, reference, replayed: true });

    /**
     * The winner of a race is mid-flight — it has claimed the key but has not
     * written its URL yet. 409 rather than 200-with-no-url (which the client
     * would have to special-case) and rather than minting a second checkout
     * (which is the entire thing being prevented).
     */
    const inProgress = () =>
      new Response(JSON.stringify({ error: 'checkout_in_progress', retryAfterSeconds: 2 }), {
        status: 409,
        headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Retry-After': '2' },
      });

    // ---------------------------------------------------------------------
    // 2. Fast path: has this exact call already been answered?
    //
    //    A read, so it is racy on its own — which is why it is not the guard.
    //    It exists so an ordinary retry minutes later costs one select instead
    //    of a failed insert, and so a client-supplied key replays for as long
    //    as its intent lives rather than only inside INTENT_REUSE_MS.
    // ---------------------------------------------------------------------
    const { data: byKey } = await admin
      .from('checkout_intents')
      .select('reference, checkout_url, consumed_at')
      .eq('user_id', user.id)
      .eq('idempotency_key', idempotency.key)
      .maybeSingle();

    if (byKey) {
      if (byKey.checkout_url) {
        return replay(byKey.reference as string, byKey.checkout_url as string);
      }
      return inProgress();
    }

    // Belt to the above's braces, and only for a caller that sent no key of its
    // own: a still-open intent for the same plan and coupon, minted within
    // INTENT_REUSE_MS. A client that DID send a key has already been answered
    // definitively by the lookup above — applying a time window to an explicit
    // key would make the same key mean two different things depending on how
    // long the client took to retry.
    if (!idempotency.supplied) {
      const { data: recent } = await admin
        .from('checkout_intents')
        .select('reference, checkout_url, plan_id, coupon_id')
        .eq('user_id', user.id)
        .eq('plan_id', plan.id)
        .is('consumed_at', null)
        .gt('created_at', now - INTENT_REUSE_MS)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (recent?.checkout_url && (recent.coupon_id ?? null) === couponId) {
        return replay(recent.reference as string, recent.checkout_url as string);
      }
    }

    // ---------------------------------------------------------------------
    // 3. Claim the key. THIS is the guard — everything expensive is below it.
    // ---------------------------------------------------------------------
    const { data: intent, error: intentError } = await admin
      .from('checkout_intents')
      .insert({
        user_id: user.id,
        plan_id: plan.id,
        coupon_id: couponId,
        idempotency_key: idempotency.key,
        created_at: now,
        updated_at: now,
      })
      .select('reference')
      .single();

    if (intentError) {
      if (intentError.code !== UNIQUE_VIOLATION) {
        return json({ error: intentError.message }, 500);
      }
      // Lost the race. The winner either has a URL by now (replay it) or is
      // still working (409). Re-read rather than assume: between the failed
      // insert and here, it may well have finished.
      const { data: winner } = await admin
        .from('checkout_intents')
        .select('reference, checkout_url')
        .eq('user_id', user.id)
        .eq('idempotency_key', idempotency.key)
        .maybeSingle();
      if (winner?.checkout_url) {
        return replay(winner.reference as string, winner.checkout_url as string);
      }
      return inProgress();
    }

    const reference = intent.reference as string;

    // ---------------------------------------------------------------------
    // 4. Resolve the Safepay Plan to check out against, creating it if this is
    //    the first time anybody has used this plan/coupon combination.
    // ---------------------------------------------------------------------
    let safepayPlanId: string | null = plan.safepay_plan_id as string | null;

    if (couponId) {
      // Discounted price needs its own Plan object — Safepay Plans are
      // fixed-price, there is no discount-on-an-existing-plan call.
      const { data: variant } = await admin
        .from('plan_coupon_variants')
        .select('safepay_plan_id')
        .eq('base_plan_id', plan.id)
        .eq('coupon_id', couponId)
        .maybeSingle();

      if (variant?.safepay_plan_id) {
        safepayPlanId = variant.safepay_plan_id as string;
      } else {
        const createdId = await createSafepayPlan({
          amountCents: discountedPriceCents!,
          currency: plan.currency as string,
          ...recurrenceOf(plan.period as string),
          name: `${plan.name} (${body.couponCode})`,
        });

        // The insert's own error was previously discarded, which mattered:
        // `plan_coupon_variants`' primary key is `(base_plan_id, coupon_id)`
        // (0048), so two first-ever checkouts on one coupon both created a Plan
        // and the loser silently kept using its own — two Plan objects for one
        // cached row, and the row naming only one of them. On conflict, re-read
        // and defer to the winner, so both callers check out against the same
        // Plan and only one is ever referenced.
        const { error: variantError } = await admin.from('plan_coupon_variants').insert({
          base_plan_id: plan.id,
          coupon_id: couponId,
          safepay_plan_id: createdId,
          price_cents: discountedPriceCents,
          created_at: now,
        });

        if (!variantError) {
          safepayPlanId = createdId;
        } else if (variantError.code === UNIQUE_VIOLATION) {
          const { data: winner } = await admin
            .from('plan_coupon_variants')
            .select('safepay_plan_id')
            .eq('base_plan_id', plan.id)
            .eq('coupon_id', couponId)
            .maybeSingle();
          // `createdId` is now orphaned at Safepay. Logged rather than hidden:
          // it is harmless (a Plan nothing subscribes to bills nobody) but it
          // is the one leak this path can still produce, and the log is how
          // anybody would ever know to tidy it up.
          console.error('plan variant race — discarding the Plan this call created', {
            discarded: createdId,
            kept: winner?.safepay_plan_id,
            basePlanId: plan.id,
            couponId,
          });
          safepayPlanId = (winner?.safepay_plan_id as string | undefined) ?? createdId;
        } else {
          return json({ error: variantError.message }, 500);
        }
      }
    } else if (!safepayPlanId) {
      const createdId = await createSafepayPlan({
        amountCents: plan.price_cents as number,
        currency: plan.currency as string,
        ...recurrenceOf(plan.period as string),
        name: plan.name as string,
      });
      // Only fills an empty slot. Without the `is null` guard, a concurrent
      // first checkout would overwrite the id the other call is already
      // checking out against — the same race the coupon-variant branch above
      // resolves with a primary key, resolved here with a conditional update
      // because `billing_plans.safepay_plan_id` is a cache slot rather than a
      // key and cannot carry a constraint.
      await admin
        .from('billing_plans')
        .update({ safepay_plan_id: createdId })
        .eq('id', plan.id)
        .is('safepay_plan_id', null);
      const { data: refreshed } = await admin
        .from('billing_plans')
        .select('safepay_plan_id')
        .eq('id', plan.id)
        .maybeSingle();
      safepayPlanId = (refreshed?.safepay_plan_id as string | undefined) ?? createdId;
      if (safepayPlanId !== createdId) {
        // Lost the race, so defer to the winner and say what was left behind —
        // same reasoning as the variant branch: the orphan is harmless (a Plan
        // nothing subscribes to bills nobody) but silence is how it stays
        // untidied forever.
        console.error('billing plan race — discarding the Plan this call created', {
          discarded: createdId,
          kept: safepayPlanId,
          planId: plan.id,
        });
      }
    }

    if (!safepayPlanId) return json({ error: 'could not resolve a Safepay plan' }, 500);

    // ---------------------------------------------------------------------
    // 5. Mint the checkout, then record its URL on the intent so a replay has
    //    something to answer with.
    // ---------------------------------------------------------------------

    // `daykeep://`, not the pre-rebrand `lifeos://` this branch was written
    // against — app.json's scheme is what the OS routes on, and the old value
    // would hand the payment back to a scheme nothing claims.
    const returnBase = Deno.env.get('SAFEPAY_RETURN_BASE_URL') ?? 'daykeep://billing/callback';

    const safepay = safepayClient();
    const checkoutUrl = await safepay.checkout.createSubscription({
      planId: safepayPlanId,
      reference,
      redirectUrl: `${returnBase}?status=success`,
      cancelUrl: `${returnBase}?status=cancelled`,
    });

    const { error: urlError } = await admin
      .from('checkout_intents')
      .update({ checkout_url: checkoutUrl, updated_at: Date.now() })
      .eq('reference', reference);
    // Not fatal: the checkout is real and the user should be sent to it. What
    // is lost is only the ability to REPLAY it — a later retry on the same key
    // will see a claimed row with no URL and get a 409, which is a worse
    // experience than a replay and a much better one than a second charge.
    if (urlError) {
      console.error('could not record checkout_url — replays will 409', {
        reference,
        error: urlError.message,
      });
    }

    return json({ ok: true, checkoutUrl, reference });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Unexpected error' }, 500);
  }
});
