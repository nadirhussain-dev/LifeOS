// Supabase Edge Function: notify-album
//
// Push notification fan-out for shared albums — modeled directly on
// notify-group (see its header for the two-client rationale: the caller's JWT
// answers "are they actually in this album?" via RLS, the service-role key is
// the only thing allowed to read push_tokens/profiles for someone else).
//
// Two kinds of call:
//   - `message`: a new chat message. Every OTHER current member gets pushed.
//     The client supplies `title`/`body` itself — this function never sees
//     album names or message text, both of which are end-to-end ciphertext
//     it has no key to read. It only ever relays what the client already
//     decided to say generically (e.g. "New message" + a sender name the
//     client already knows locally).
//   - `invite`: a fresh invite was created for `inviteeEmail`. Requires a
//     real, still-open row in shared_album_invitations for that album+email
//     (checked through the caller's own token, so RLS scopes it to albums
//     they're actually in) — otherwise any member could target an arbitrary
//     email they never invited. If that email matches an existing account,
//     that ONE person gets a generic "you have a pending invite" push.
//     Deliberately carries no token/code/payload — the actual invite link is
//     still delivered by the existing share sheet/clipboard flow; this is an
//     awareness nudge only, not a second channel for the secret itself.
//
// Notification delivery is NOT the source of truth for either case — errors
// here are non-fatal from the client's perspective, same as notify-group.
//
// Deploy:
//   supabase functions deploy notify-album
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected by the runtime.
// EXPO_ACCESS_TOKEN is optional; set it if you enable Expo's push security.
//
// This file is Deno (URL imports) and is excluded from the app's tsconfig.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
/** Expo rejects batches larger than this. */
const CHUNK = 100;

type Payload = {
  albumId: string;
  kind: 'message' | 'invite';
  title: string;
  body: string;
  /** Deep-link target, e.g. /private/albums/<id>/chat. */
  route?: string;
  /** Required when `kind === 'invite'`. */
  inviteeEmail?: string;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

async function sendExpoPush(
  tokens: string[],
  message: { title: string; body: string; route: string },
): Promise<{ sent: number; failures: number }> {
  const expoToken = Deno.env.get('EXPO_ACCESS_TOKEN');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (expoToken) headers.Authorization = `Bearer ${expoToken}`;

  let sent = 0;
  const failures: unknown[] = [];

  for (let i = 0; i < tokens.length; i += CHUNK) {
    const messages = tokens.slice(i, i + CHUNK).map((to) => ({
      to,
      title: message.title,
      body: message.body,
      sound: 'default',
      data: { route: message.route, category: 'private' },
    }));
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify(messages),
      });
      if (res.ok) sent += messages.length;
      else failures.push(await res.text());
    } catch (error) {
      failures.push(String(error));
    }
  }
  return { sent, failures: failures.length };
}

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
  if (!payload?.albumId || !payload.kind || !payload.title || !payload.body) {
    return json({ error: 'bad_request' }, 400);
  }
  if (payload.kind === 'invite' && !payload.inviteeEmail) {
    return json({ error: 'bad_request' }, 400);
  }

  const url = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  // 1. Who is calling, and are they really in this album? Asked through
  //    their own token so RLS answers it — never from the request body.
  const asCaller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData } = await asCaller.auth.getUser();
  const actorId = userData?.user?.id;
  if (!actorId) return json({ error: 'unauthorized' }, 401);

  const { data: membership, error: membershipError } = await asCaller
    .from('shared_album_members')
    .select('user_id')
    .eq('album_id', payload.albumId)
    .is('deleted_at', null);

  if (membershipError) return json({ error: 'forbidden' }, 403);
  const members = membership ?? [];
  if (!members.some((m: { user_id: string | null }) => m.user_id === actorId)) {
    // RLS returns an empty set rather than an error for a non-member, so the
    // absence of the caller in the result IS the rejection.
    return json({ error: 'forbidden' }, 403);
  }

  const admin = createClient(url, serviceKey);
  const route = payload.route ?? `/private/albums/${payload.albumId}`;

  if (payload.kind === 'invite') {
    // The membership check above only proves the caller belongs to SOME
    // album — not that they actually invited `inviteeEmail` to it. Require a
    // real, still-open invitation row (asked through the caller's own token
    // so RLS scopes it to albums they're in, same discipline as the
    // membership check) before this function will contact anyone by email.
    const { data: pendingInvite } = await asCaller
      .from('shared_album_invitations')
      .select('id')
      .eq('album_id', payload.albumId)
      .eq('email', payload.inviteeEmail.toLowerCase())
      .is('accepted_at', null)
      .gt('expires_at', Date.now())
      .maybeSingle();
    if (!pendingInvite) return json({ error: 'forbidden' }, 403);

    const { data: profile } = await admin
      .from('profiles')
      .select('id')
      .eq('email', payload.inviteeEmail)
      .maybeSingle();
    if (!profile?.id) return json({ sent: 0, reason: 'not_a_user' });

    const { data: tokenRows } = await admin
      .from('push_tokens')
      .select('token')
      .eq('user_id', profile.id);
    const tokens = (tokenRows ?? []).map((r: { token: string }) => r.token);
    if (tokens.length === 0) return json({ sent: 0, reason: 'no_tokens' });

    const result = await sendExpoPush(tokens, { title: payload.title, body: payload.body, route });
    return json(result);
  }

  // kind === 'message': everyone else currently in the album.
  const recipientIds = members
    .map((m: { user_id: string | null }) => m.user_id)
    .filter((id: string | null): id is string => !!id && id !== actorId);
  if (recipientIds.length === 0) return json({ sent: 0, reason: 'no_recipients' });

  const { data: tokenRows, error: tokenError } = await admin
    .from('push_tokens')
    .select('token')
    .in('user_id', recipientIds);
  if (tokenError) return json({ error: 'token_lookup_failed' }, 500);

  const tokens = (tokenRows ?? []).map((r: { token: string }) => r.token);
  if (tokens.length === 0) return json({ sent: 0, reason: 'no_tokens' });

  // A partial failure is still reported 200: the write it accompanies already
  // succeeded, and the client must not retry it because a push bounced.
  const result = await sendExpoPush(tokens, { title: payload.title, body: payload.body, route });
  return json(result);
});
