// Supabase Edge Function: challenge-maintenance
//
// The clock the streak challenge never had.
//
// `settle_stale_runs()` has existed and been correct since migration 0048, and
// nothing has ever called it. It is granted to `service_role`, so it was never
// reachable from the app: the two public entry points cannot stand in for it —
// `record_challenge_day` only ever credits, and `challenge_today()` is declared
// `stable` and so cannot write at all.
//
// The consequence was not a rough edge. With no settler, a missed day is never
// judged: shields are never spent, demotion never fires, and `qualified_days`
// simply freezes at whatever it was when somebody stopped. Stop for a month,
// come back, and the run is exactly where you left it — the entire tension the
// ladder is built on was switched off, and every retention number measured
// against it described a game with no way to lose.
//
// 0069 adds the second half — `finalize_ended_seasons()`, which closes out runs
// whose season is over — and wraps both in `run_challenge_maintenance()` so the
// ordering (settle, *then* finish) is a property of the database rather than of
// whoever writes the next scheduler.
//
// ## Scheduling
//
// **Hourly, and specifically not nightly.** Every date in this engine is derived
// from each enrollment's own frozen `tz_offset_minutes`, so "midnight" happens
// at twenty-four different moments; one nightly run in one timezone settles most
// of the cohort late, and "late" here means somebody sees a streak they have
// already lost. Both loops touch only rows that are behind, so an hourly run
// costs almost nothing once the backlog is clear.
//
// Idempotent, so a retried or overlapping run is harmless and a missed run
// costs only delay.
//
//   select cron.schedule(
//     'challenge-maintenance', '7 * * * *',
//     $$ select net.http_post(
//          url := '<project>/functions/v1/challenge-maintenance',
//          headers := jsonb_build_object('Authorization', 'Bearer <service-role-key>')
//        ) $$
//   );
//
// Minute 7 rather than 0 on purpose: the top of the hour is where every other
// scheduled job in every other system also lives.
//
// Unlike `check-push-receipts`, **this one is not safe to leave undeployed.**
// That one degrades (dead tokens accumulate); this one is the difference between
// a challenge that can be lost and one that cannot.
//
// Deploy:
//   supabase functions deploy challenge-maintenance
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected by the runtime.
//
// This file is Deno (URL imports) and is excluded from the app's tsconfig.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  // Service-role only. There is no per-user authorisation to do here — it acts
  // on every account's runs — so the check is simply "is the caller the
  // scheduler". The RPC is revoked from `authenticated` besides, so this is the
  // outer of two locks rather than the only one.
  const auth = req.headers.get('Authorization');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  if (auth !== `Bearer ${serviceKey}`) return json({ error: 'unauthorized' }, 401);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey);

  const { data, error } = await admin.rpc('run_challenge_maintenance');

  if (error) {
    // Logged rather than swallowed: this running and failing looks identical to
    // this never having been deployed, which is the state it exists to end.
    console.error('challenge-maintenance failed', error.message);
    return json({ error: 'maintenance_failed', detail: error.message }, 500);
  }

  const result = (data ?? {}) as { settled?: number; finished?: number };
  return json({ settled: result.settled ?? 0, finished: result.finished ?? 0 });
});
