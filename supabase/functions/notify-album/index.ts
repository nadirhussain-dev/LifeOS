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

import { pruneDeadTokens, recordTickets, sendExpoPush } from '../_shared/expo-push.ts';
import { consumeRateLimit, tooManyRequests } from '../_shared/rate-limit.ts';

/**
 * Shared updates land on the one channel whose id never moves.
 *
 * Deliberately still the general channel, not the purpose-specific
 * `daykeep-albums-v3` that lib/notifications.ts now creates. Android silently
 * drops a notification naming a channel the device does not have, so naming it
 * here would lose every push to anybody who has not updated yet. Switch this
 * one release after the build carrying that channel has rolled out.
 */
const PUSH_CHANNEL_ID = 'daykeep-general-v3';

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

/**
 * One send, plus the bookkeeping every send owes.
 *
 * Both branches below (an invite to one person, a message to the album) do
 * exactly the same three things, and doing them in one place is what stops the
 * two drifting — which is how this file ended up with its own copy of a sender
 * in the first place.
 *
 * `accepted`, not "sent". A ticket means Expo took the message; only the
 * receipt fetched later says a device did. Reporting the first as the second is
 * what let `push_tokens` fill with dead entries and still look healthy.
 */
async function deliver(
  admin: ReturnType<typeof createClient>,
  tokens: string[],
  payload: Payload,
  route: string,
): Promise<{ accepted: number; rejected: number }> {
  const outcome = await sendExpoPush(
    tokens,
    {
      title: payload.title,
      body: payload.body,
      channelId: PUSH_CHANNEL_ID,
      // One notification per album rather than one per message. A fast
      // back-and-forth should not be twenty separate buzzes about the same
      // conversation — the device replaces the previous one.
      collapseId: `album:${payload.albumId}`,
      data: { route, category: 'private' },
    },
    { fetch, accessToken: Deno.env.get('EXPO_ACCESS_TOKEN') },
  );

  await pruneDeadTokens(admin as never, outcome.deadTokens);
  await recordTickets(admin as never, outcome, Date.now());

  return { accepted: outcome.accepted, rejected: outcome.rejected };
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

  // Same placement and reasoning as notify-group. The budget here is twice its
  // size because this one carries chat: a fast back-and-forth in an album
  // genuinely produces a push per message, where a shared-expense group
  // produces one per settled expense.
  const budget = await consumeRateLimit(asCaller, 'edge_notify_album');
  if (!budget.allowed) return tooManyRequests(budget);

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

    const result = await deliver(admin, tokens, payload, route);
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
  const result = await deliver(admin, tokens, payload, route);
  return json(result);
});
