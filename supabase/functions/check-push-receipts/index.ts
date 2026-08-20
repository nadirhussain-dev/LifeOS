// Supabase Edge Function: check-push-receipts
//
// The half of push delivery that cannot happen on the request path.
//
// `notify-group` and `notify-album` hand a message to Expo and get back a
// ticket, which says only that Expo accepted it. Whether APNs or FCM actually
// took it is knowable some minutes later, from a receipt fetched by ticket id.
// Waiting for that inline would hold an edge function open for minutes, during
// a user action, to learn something nobody is waiting for — so the ticket ids
// are written to `push_receipts` (migration 0068) and this reads them later.
//
// What it is actually for: `DeviceNotRegistered`. A device that was uninstalled
// after its last successful push does not fail at send time — it fails here.
// Without this, that token stays in `push_tokens` forever, every future fan-out
// pays to send to it, and every one of those sends is counted as a success.
//
// ## Scheduling
//
// Meant to run on a cron — every 15 minutes is ample, and the function is
// idempotent, so a missed run costs nothing but delay. Set it up either with
// Supabase's scheduled functions or pg_cron:
//
//   select cron.schedule(
//     'check-push-receipts', '*/15 * * * *',
//     $$ select net.http_post(
//          url := '<project>/functions/v1/check-push-receipts',
//          headers := jsonb_build_object('Authorization', 'Bearer <service-role-key>')
//        ) $$
//   );
//
// **It is safe to never deploy this.** Nothing else depends on it; the cost of
// its absence is dead tokens accumulating, which is exactly where things stood
// before it existed. The table sweeps itself either way (see below).
//
// Deploy:
//   supabase functions deploy check-push-receipts
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected by the runtime.
// EXPO_ACCESS_TOKEN is optional; set it if you enable Expo's push security.
//
// This file is Deno (URL imports) and is excluded from the app's tsconfig.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

import { fetchExpoReceipts, pruneDeadTokens } from '../_shared/expo-push.ts';

/**
 * How long a ticket may sit before it is given up on.
 *
 * Expo does not keep receipts indefinitely, and a ticket it cannot resolve in a
 * day is not going to. Bounded so a checker that stops running — or one that
 * keeps meeting an Expo outage — cannot leave the table growing forever.
 */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Receipts are not ready the instant a ticket is issued. Reading one too early
 * gets `pending` back, which costs a round trip and re-checks the same row on
 * the next run, so tickets younger than this are simply left alone.
 */
const MIN_AGE_MS = 5 * 60 * 1000;

/** Rows per run. Bounds the work an invocation does; the next run picks up the
 *  rest, and at a 15-minute cadence this clears a large backlog quickly. */
const BATCH = 500;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  // Service-role only. There is no per-user authorisation to do here — this
  // reads a table no user can see and acts on every account's tokens — so the
  // check is simply "is the caller the scheduler".
  const auth = req.headers.get('Authorization');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  if (auth !== `Bearer ${serviceKey}`) return json({ error: 'unauthorized' }, 401);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey);
  const now = Date.now();

  // Before anything else, so the table is bounded even on a run where Expo is
  // unreachable and nothing below can make progress.
  const { data: swept } = await admin.rpc('sweep_push_receipts', {
    p_before: now - MAX_AGE_MS,
  });

  const { data: rows, error } = await admin
    .from('push_receipts')
    .select('ticket_id, token')
    .lte('created_at', now - MIN_AGE_MS)
    .order('created_at', { ascending: true })
    .limit(BATCH);

  if (error) return json({ error: 'lookup_failed' }, 500);

  const pending = (rows ?? []) as { ticket_id: string; token: string }[];
  if (pending.length === 0) return json({ swept: swept ?? 0, checked: 0 });

  const verdict = await fetchExpoReceipts(
    pending.map((row) => row.ticket_id),
    { fetch, accessToken: Deno.env.get('EXPO_ACCESS_TOKEN') },
  );

  // The point of the whole exercise: a device that went away after its last
  // successful push says so here and nowhere else.
  const byTicket = new Map(pending.map((row) => [row.ticket_id, row.token]));
  const deadTokens = [
    ...new Set(verdict.fatal.map((id) => byTicket.get(id)).filter((t): t is string => !!t)),
  ];
  await pruneDeadTokens(admin as never, deadTokens);

  // Resolved either way — delivered, dead, or failed for a reason that is not
  // the token's fault. Only `pending` rows are left for the next run, and the
  // token cascade in 0068 has already taken the fatal ones' rows with it.
  const resolved = [...verdict.delivered, ...verdict.fatal, ...verdict.failed];
  if (resolved.length > 0) {
    await admin.from('push_receipts').delete().in('ticket_id', resolved);
  }

  // A receipt Expo has no answer for yet is stamped rather than deleted, so a
  // run can tell "never looked" from "looked and it was not ready".
  if (verdict.pending.length > 0) {
    await admin.from('push_receipts').update({ checked_at: now }).in('ticket_id', verdict.pending);
  }

  return json({
    swept: swept ?? 0,
    checked: pending.length,
    delivered: verdict.delivered.length,
    deadTokens: deadTokens.length,
    stillPending: verdict.pending.length,
  });
});
