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
// Deploy:
//   supabase functions deploy safepay-checkout
//   supabase secrets set SAFEPAY_API_KEY=... SAFEPAY_SECRET_KEY=... SAFEPAY_ENVIRONMENT=sandbox
//
// This file is Deno (URL imports) and is excluded from the app's tsconfig.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createSafepayPlan, safepayClient, toSafepayInterval } from '../_shared/safepay.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

type Body = { planId?: string; couponCode?: string };

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

    let couponId: string | null = null;
    let safepayPlanId: string | null = plan.safepay_plan_id as string | null;

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

      // Discounted price needs its own Plan object — Safepay Plans are
      // fixed-price, there is no discount-on-an-existing-plan call.
      const discountedCents =
        coupon.discount_type === 'percent'
          ? Math.round((plan.price_cents as number) * (1 - coupon.discount_value / 100))
          : Math.max(0, (plan.price_cents as number) - coupon.discount_value);

      // service-role client for everything past this point: billing_plans/
      // plan_coupon_variants have no client write policy (0034/0048's own
      // headers), same as every other admin-owned table in this schema.
      const admin = createClient(supabaseUrl, serviceKey);

      const { data: variant } = await admin
        .from('plan_coupon_variants')
        .select('safepay_plan_id')
        .eq('base_plan_id', plan.id)
        .eq('coupon_id', couponId)
        .maybeSingle();

      if (variant?.safepay_plan_id) {
        safepayPlanId = variant.safepay_plan_id;
      } else {
        const createdId = await createSafepayPlan({
          amountCents: discountedCents,
          currency: plan.currency as string,
          interval: toSafepayInterval(plan.period as 'month' | 'year'),
          name: `${plan.name} (${body.couponCode})`,
        });
        await admin.from('plan_coupon_variants').insert({
          base_plan_id: plan.id,
          coupon_id: couponId,
          safepay_plan_id: createdId,
          price_cents: discountedCents,
          created_at: Date.now(),
        });
        safepayPlanId = createdId;
      }
    } else if (!safepayPlanId) {
      const admin = createClient(supabaseUrl, serviceKey);
      const createdId = await createSafepayPlan({
        amountCents: plan.price_cents as number,
        currency: plan.currency as string,
        interval: toSafepayInterval(plan.period as 'month' | 'year'),
        name: plan.name as string,
      });
      await admin.from('billing_plans').update({ safepay_plan_id: createdId }).eq('id', plan.id);
      safepayPlanId = createdId;
    }

    if (!safepayPlanId) return json({ error: 'could not resolve a Safepay plan' }, 500);

    // The link the webhook uses to attribute the resulting subscription back
    // to this user/plan/coupon — see 0049's header for why this exists.
    const admin = createClient(supabaseUrl, serviceKey);
    const { data: intent, error: intentError } = await admin
      .from('checkout_intents')
      .insert({ user_id: user.id, plan_id: plan.id, coupon_id: couponId, created_at: Date.now() })
      .select('reference')
      .single();
    if (intentError) return json({ error: intentError.message }, 500);

    // `daykeep://`, not the pre-rebrand `lifeos://` this branch was written
    // against — app.json's scheme is what the OS routes on, and the old value
    // would hand the payment back to a scheme nothing claims.
    const returnBase = Deno.env.get('SAFEPAY_RETURN_BASE_URL') ?? 'daykeep://billing/callback';

    const safepay = safepayClient();
    const checkoutUrl = await safepay.checkout.createSubscription({
      planId: safepayPlanId,
      reference: intent.reference as string,
      redirectUrl: `${returnBase}?status=success`,
      cancelUrl: `${returnBase}?status=cancelled`,
    });

    return json({ ok: true, checkoutUrl });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Unexpected error' }, 500);
  }
});
