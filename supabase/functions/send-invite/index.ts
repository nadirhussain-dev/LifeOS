// Supabase Edge Function: send-invite
//
// Emails a group invitation. The token is minted HERE rather than in the app:
// a client-generated invite token is a bearer credential the client could
// forge or leak, and the whole point is that holding it grants access to a
// group.
//
// Membership is verified through the caller's own JWT, so the RLS policies in
// 0003 decide whether this person may invite anybody to this group.
//
// Deploy:
//   supabase functions deploy send-invite
//   supabase secrets set RESEND_API_KEY=...  INVITE_FROM="Daykeep <invites@yourdomain.com>"
//   supabase secrets set APP_INVITE_BASE_URL="https://yourdomain.com/join"
//
// The sending domain must have SPF and DKIM configured or invitations land in
// spam. Without RESEND_API_KEY the function still creates the invitation and
// returns the link, so the inviter can share it manually — the group is usable
// before email is switched on.
//
// This file is Deno (URL imports) and is excluded from the app's tsconfig.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000; // two weeks

type Payload = { groupId: string; memberId: string; email: string; groupName: string };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/** URL-safe, unguessable. 32 bytes of CSPRNG, base64url, no padding. */
function mintToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'unauthorized' }, 401);

  let payload: Payload;
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  if (!payload?.groupId || !payload.memberId || !payload.email) {
    return json({ error: 'bad_request' }, 400);
  }

  const url = Deno.env.get('SUPABASE_URL')!;
  const asCaller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData } = await asCaller.auth.getUser();
  const inviter = userData?.user;
  if (!inviter) return json({ error: 'unauthorized' }, 401);

  const token = mintToken();
  const now = Date.now();

  // Written through the caller's client, so a non-member is rejected by the
  // invitations policy rather than by a check we would have to remember.
  const { error: insertError } = await asCaller.rpc('create_group_invitation', {
    p_invitation_id: crypto.randomUUID(),
    p_group_id: payload.groupId,
    p_member_id: payload.memberId,
    p_email: payload.email,
    p_token: token,
    p_expires_at: now + INVITE_TTL_MS,
    p_now: now,
  });
  if (insertError) return json({ error: 'forbidden', detail: insertError.message }, 403);

  const base = Deno.env.get('APP_INVITE_BASE_URL') ?? 'https://daykeep.app/join';
  const link = `${base}/${token}`;

  const resendKey = Deno.env.get('RESEND_API_KEY');
  if (!resendKey) {
    // Email not configured yet: the invitation is real and redeemable, so hand
    // the link back and let the inviter deliver it themselves.
    return json({ ok: true, link, emailed: false, reason: 'email_not_configured' });
  }

  const groupName = escapeHtml(payload.groupName || 'a group');
  const inviterName = escapeHtml(
    (inviter.user_metadata?.display_name as string | undefined) ?? inviter.email ?? 'Someone',
  );

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: Deno.env.get('INVITE_FROM') ?? 'Daykeep <invites@daykeep.app>',
        to: [payload.email],
        subject: `${inviterName} added you to ${groupName}`,
        // Brand colors match constants/design-tokens.ts's light palette
        // (accent #188b61, foreground #161c19, mutedForeground #6d7a74,
        // border #e2e9e5) — this used to carry a leftover teal (#0d9488)
        // nothing else in the app uses. Kept as one plain <div>, not the
        // templated card in supabase/templates/: this email carries a link,
        // not a code, so it doesn't share that shape.
        html: `
          <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px">
            <div style="font-family:'Sora','Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:18px;font-weight:700;letter-spacing:-0.2px;color:#161c19;margin:0 0 20px">
              Life<span style="color:#188b61">OS</span>
            </div>
            <h2 style="margin:0 0 12px;color:#161c19">${inviterName} added you to “${groupName}”</h2>
            <p style="color:#6d7a74;line-height:1.5;margin:0 0 20px">
              You are sharing expenses in this group on Daykeep. Open the link below
              to join and see what you owe or are owed.
            </p>
            <a href="${link}"
               style="display:inline-block;background:#188b61;color:#ffffff;text-decoration:none;
                      padding:12px 20px;border-radius:10px;font-weight:600">
              Join ${groupName}
            </a>
            <p style="color:#9aa8a1;font-size:12px;line-height:1.5;margin:20px 0 0;border-top:1px solid #e2e9e5;padding-top:16px">
              This invitation expires in 14 days. If you weren't expecting it you can ignore this email.
            </p>
          </div>`,
      }),
    });

    if (!res.ok) {
      // The invitation exists regardless; surface the link so the flow is not
      // dead-ended by a provider problem.
      return json({ ok: true, link, emailed: false, reason: await res.text() });
    }
  } catch (error) {
    return json({ ok: true, link, emailed: false, reason: String(error) });
  }

  return json({ ok: true, link, emailed: true });
});
