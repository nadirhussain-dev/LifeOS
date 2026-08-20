// Supabase Edge Function: notify-group
//
// Push notification fan-out for shared expense groups. The client calls this
// after a successful write; it collects the OTHER members' device tokens and
// hands them to Expo's push service.
//
// Two clients are used deliberately:
//   - the caller's JWT, to answer "is this person actually in this group?"
//     using the RLS policies from 0003 rather than trusting the request body
//   - the service-role key, to read push_tokens, which is `*_own` and would
//     otherwise expose nothing but the caller's own device
//
// Notification delivery is NOT the source of truth. If this fails the expense
// still exists, which is the correct failure direction — so the client treats
// errors here as non-fatal.
//
// Deploy:
//   supabase functions deploy notify-group
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected by the runtime.
// EXPO_ACCESS_TOKEN is optional; set it if you enable Expo's push security.
//
// This file is Deno (URL imports) and is excluded from the app's tsconfig.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

import { pruneDeadTokens, recordTickets, sendExpoPush } from '../_shared/expo-push.ts';
import { consumeRateLimit, tooManyRequests } from '../_shared/rate-limit.ts';

/** Shared updates land on the one channel whose id never moves — see
 *  PUSH_CHANNEL_ID in lib/notifications.ts and app.json's `defaultChannel`. */
const PUSH_CHANNEL_ID = 'daykeep-general-v3';

type Payload = {
  groupId: string;
  title: string;
  body: string;
  /** Deep-link target, e.g. /split/<groupId>. */
  route?: string;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

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
  if (!payload?.groupId || !payload.title) return json({ error: 'bad_request' }, 400);

  const url = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  // 1. Who is calling, and are they really in this group? Asked through their
  //    own token so RLS answers it — never from the request body.
  const asCaller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData } = await asCaller.auth.getUser();
  const actorId = userData?.user?.id;
  if (!actorId) return json({ error: 'unauthorized' }, 401);

  // Before the membership lookup, not after: the budget bounds the database
  // work this function does on a caller's behalf as well as the Expo fan-out at
  // the end of it, and the membership query is the more expensive of the two
  // for a caller who is not in the group and is looping to find out.
  const budget = await consumeRateLimit(asCaller, 'edge_notify_group');
  if (!budget.allowed) return tooManyRequests(budget);

  const { data: membership, error: membershipError } = await asCaller
    .from('expense_group_members')
    .select('id, user_id')
    .eq('group_id', payload.groupId)
    .is('deleted_at', null);

  if (membershipError) return json({ error: 'forbidden' }, 403);
  const members = membership ?? [];
  if (!members.some((m: { user_id: string | null }) => m.user_id === actorId)) {
    // RLS returns an empty set rather than an error for a non-member, so the
    // absence of the caller in the result IS the rejection.
    return json({ error: 'forbidden' }, 403);
  }

  // 2. Everyone else in the group who has a device registered.
  const recipientIds = members
    .map((m: { user_id: string | null }) => m.user_id)
    .filter((id: string | null): id is string => !!id && id !== actorId);

  if (recipientIds.length === 0) return json({ sent: 0, reason: 'no_recipients' });

  const admin = createClient(url, serviceKey);
  const { data: tokenRows, error: tokenError } = await admin
    .from('push_tokens')
    .select('token')
    .in('user_id', recipientIds);

  if (tokenError) return json({ error: 'token_lookup_failed' }, 500);

  const tokens = (tokenRows ?? []).map((r: { token: string }) => r.token);
  if (tokens.length === 0) return json({ sent: 0, reason: 'no_tokens' });

  // 3. Hand off to Expo, and read what it says back.
  const outcome = await sendExpoPush(
    tokens,
    {
      title: payload.title,
      body: payload.body,
      channelId: PUSH_CHANNEL_ID,
      // One notification per group, replaced rather than stacked. Four people
      // settling expenses in a minute should not be four buzzes about the same
      // group — the same argument the local scheduler's dedupe key makes.
      collapseId: `split:${payload.groupId}`,
      // 'split', not 'budget'. Miscategorising these put a shared-group ping
      // under the user's money reminders — so switching off budget alerts also
      // silenced their group, and the inbox filed it in the wrong place.
      data: { route: payload.route ?? `/split/${payload.groupId}`, category: 'split' },
    },
    { fetch, accessToken: Deno.env.get('EXPO_ACCESS_TOKEN') },
  );

  // Expo answers a 200 with a per-message ticket that may itself say the device
  // is gone. Acting on that is what stops `push_tokens` growing an entry per
  // uninstall and being paid for on every fan-out afterwards.
  await pruneDeadTokens(admin, outcome.deadTokens);
  await recordTickets(admin, outcome, Date.now());

  // `accepted`, not "sent": a ticket means Expo took the message, and only the
  // receipt fetched later says a device did. Reporting it as delivery is the
  // thing this function used to get wrong.
  //
  // A partial failure is still reported 200: the write it accompanies already
  // succeeded, and the client must not retry the expense because a push bounced.
  return json({ accepted: outcome.accepted, rejected: outcome.rejected });
});
