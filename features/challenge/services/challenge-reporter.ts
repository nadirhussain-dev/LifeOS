import { useAuthStore } from '@/features/auth/services/auth-store';
import { useChallengeStore } from '@/features/challenge/store/challenge-store';
import { isSupabaseConfigured } from '@/lib/env';
import { supabase } from '@/lib/supabase';

/**
 * Offers the buffered evidence to the server, and nothing else.
 *
 * Same shape as `features/analytics/services/usage-reporter.ts`: one in-flight
 * promise, never throws, and a failure leaves the buffer exactly as it was. A
 * streak submission failing is not a reason for anything the user is doing to
 * fail — they are usually not even looking at the challenge when it runs.
 *
 * ## Why nothing is drained
 *
 * The usage reporter empties its buffer on send, because its counters are
 * additive on the server. This one does the opposite and keeps everything until
 * the day rolls out of the window, because `record_challenge_day` is idempotent
 * (a composite primary key on user, season and day) and takes the *whole* day's
 * map each time. Re-sending is free, so the buffer is never in a state where a
 * lost response has cost somebody a day. Given the alternative is a user losing
 * a day they earned because a request timed out at the wrong moment, sending
 * the same numbers twice is the cheap side of the trade.
 *
 * ## What it deliberately does not decide
 *
 * Whether the day counts. The response says so; this file only reports it back
 * into the store so the UI can stop guessing. A client that decided its own
 * days is a client that always decides yes.
 */

export type RecordDayResult = {
  ok: boolean;
  qualified?: boolean;
  alreadyCounted?: boolean;
  reason?: string;
  outstanding?: string[];
  qualifiedDays?: number;
  shields?: number;
  shieldEarned?: boolean;
  tierDay?: number;
  completed?: boolean;
  localDay?: string;
};

let inFlight: Promise<void> | null = null;

export function flushChallenge(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = runFlush().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function runFlush(): Promise<void> {
  if (!isSupabaseConfigured) return;

  const store = useChallengeStore.getState();
  if (!store.hydrated || !store.enrolled) return;
  // Guests have no run to report into. The engine is an account feature because
  // the ledger lives on the server; there is nothing to do here offline-only.
  if (!useAuthStore.getState().user?.id) return;

  store.prune();

  for (const day of useChallengeStore.getState().pendingDays()) {
    try {
      const { data, error } = await supabase.rpc('record_challenge_day', {
        p_local_day: day.day,
        p_module_writes: day.writes,
        p_active_seconds: day.activeSeconds,
        p_device_id: null,
      });
      if (error) throw new Error(error.message);

      const result = (data ?? {}) as RecordDayResult;
      // A day the server has said it will never take is a day worth forgetting,
      // or it is retried on every foreground for as long as the app is
      // installed. Dropped by name rather than by pruning the window, because
      // the phone's date and the server's can disagree — which is the only way
      // this branch is reached at all.
      if (result.ok === false && result.reason === 'day out of window') {
        useChallengeStore.getState().dropDay(day.day);
      }
    } catch {
      // Left in the buffer on purpose. An offline week should show up as a
      // catch-up when the phone reconnects, not as a week that never happened.
      return;
    }
  }
}
