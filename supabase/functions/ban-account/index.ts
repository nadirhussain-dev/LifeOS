// Supabase Edge Function: ban-account
//
// Makes a hard block actually end the session.
//
// ## The gap this closes
//
// `account_status = 'blocked'` (0010, enforced server-side by 0019) denies the
// account every read and write through RLS, pauses sync in the app, and sends
// the device a wipe command. What it does not do is invalidate the JWT the
// account is already holding. That token stays valid until it expires, and its
// refresh token keeps minting new ones — so a blocked account is refused by
// every policy while remaining, in GoTrue's view, signed in. TODO.md described
// this as "defence-in-depth, not a hard stop", which was accurate.
//
// `auth.admin.updateUserById(uid, { ban_duration })` is what actually kills it:
// GoTrue refuses to refresh a banned user's session and rejects their token.
// Only the service-role key can call it, so it has to live here.
//
// ## Deliberately admin-gated on the server, not by the caller
//
// The function does not trust the request body to say who is allowed to run it.
// It reads the caller's JWT, asks the database `is_admin()` under *that*
// caller's identity, and refuses if the answer is no. A client that lies about
// its own privileges gets nowhere, because it is not the client being asked.
//
// Deploy:
//   supabase functions deploy ban-account
//
// This file is Deno (URL imports) and is excluded from the app's tsconfig.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/** GoTrue's own duration format. '876000h' is a hundred years — its way of
 *  spelling "indefinite", since there is no unbounded value. */
const INDEFINITE = '876000h';
/** Lifting a ban is the same call with a zero duration. */
const NONE = '0s';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing Authorization header' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // Identify the caller from their own JWT, and — importantly — run the
    // privilege check as them. `is_admin()` reads auth.uid(), so this asks the
    // database whether *this* caller is an admin rather than taking the
    // request's word for it.
    const asCaller = createClient(supabaseUrl, serviceKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userError } = await asCaller.auth.getUser();
    if (userError || !userData.user) return json({ error: 'Invalid session' }, 401);

    const { data: isAdmin, error: adminError } = await asCaller.rpc('is_admin');
    if (adminError)
      return json({ error: `Could not verify privileges: ${adminError.message}` }, 500);
    if (isAdmin !== true) return json({ error: 'Not an administrator' }, 403);

    const body = (await req.json().catch(() => null)) as {
      user_id?: string;
      lift?: boolean;
      reason?: string;
    } | null;

    const targetId = body?.user_id;
    if (!targetId) return json({ error: 'user_id is required' }, 400);

    // Banning yourself locks the only account that can unban anybody. Cheap to
    // refuse, expensive to undo.
    if (targetId === userData.user.id) {
      return json({ error: 'You cannot ban your own account' }, 400);
    }

    const reason = (body?.reason ?? '').trim();
    if (!body?.lift && reason.length < 8) {
      return json({ error: 'A reason of at least 8 characters is required' }, 400);
    }

    const admin = createClient(supabaseUrl, serviceKey);

    const { error: banError } = await admin.auth.admin.updateUserById(targetId, {
      ban_duration: body?.lift ? NONE : INDEFINITE,
    });
    if (banError) return json({ error: banError.message }, 500);

    // Audited through the same table as every other operator action, and
    // deliberately *after* the ban succeeded — a log of attempted bans that did
    // not happen is worse than no log.
    await admin.from('admin_audit_log').insert({
      actor: userData.user.id,
      action: body?.lift ? 'gotrue_unban' : 'gotrue_ban',
      target_user: targetId,
      detail: { reason: reason || null },
    });

    return json({ ok: true, banned: !body?.lift }, 200);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Unexpected error' }, 500);
  }
});

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
