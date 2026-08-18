// Supabase Edge Function: safepay-cancel-subscription
//
// Cancels the caller's own subscription at Safepay. Deliberately does NOT
// flip local state — `subscriptions.status` only ever changes once the
// resulting `subscription.cancelled` webhook lands (safepay-webhook), same
// "the webhook is the one source of truth" discipline the rest of this
// feature follows. A client that could downgrade itself locally could also
// pretend a cancellation succeeded when it didn't.
//
// Deploy:
//   supabase functions deploy safepay-cancel-subscription
//
// This file is Deno (URL imports) and is excluded from the app's tsconfig.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { consumeRateLimit, tooManyRequests } from '../_shared/rate-limit.ts';
import { safepayClient } from '../_shared/safepay.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'unauthorized' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const asCaller = createClient(supabaseUrl, serviceKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userError } = await asCaller.auth.getUser();
    if (userError || !userData.user) return json({ error: 'unauthorized' }, 401);

    // Before the Safepay call, after knowing who is asking. Cancelling is cheap
    // and idempotent-ish, but it still reaches the payment provider, and a loop
    // here is a loop against them under our merchant credentials.
    const budget = await consumeRateLimit(asCaller, 'edge_safepay_cancel');
    if (!budget.allowed) return tooManyRequests(budget, corsHeaders);

    // RLS already restricts this to the caller's own row — there is no
    // p_user_id to accept from the body.
    const { data: sub, error: subError } = await asCaller
      .from('subscriptions')
      .select('safepay_subscription_id, status')
      .eq('user_id', userData.user.id)
      .maybeSingle();
    if (subError) return json({ error: subError.message }, 500);
    if (!sub) return json({ error: 'no active subscription' }, 404);
    if (sub.status === 'cancelled') return json({ ok: true, alreadyCancelled: true });

    const safepay = safepayClient();
    await safepay.subscription.cancel(sub.safepay_subscription_id);

    return json({ ok: true, pending: true });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Unexpected error' }, 500);
  }
});
