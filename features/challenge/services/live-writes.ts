import { AppState } from 'react-native';

import { useAuthStore } from '@/features/auth/services/auth-store';
import { useChallengeStore } from '@/features/challenge/store/challenge-store';
import { isSupabaseConfigured } from '@/lib/env';
import { supabase } from '@/lib/supabase';

/**
 * The live-write attestation — the client half of 0065.
 *
 * ## This file must never retry, and that is the entire design
 *
 * Everywhere else in this app, a failed request goes in a buffer and is sent
 * again later. `challenge-reporter.ts` says so in its own header, and it is
 * right to: losing a day you earned because a request timed out is the worse
 * error.
 *
 * Here it is inverted, and it has to be. The rule 0065 enforces is "you were
 * online while you did the work". A queue of failed attestations flushed on
 * reconnect would arrive stamped with the server's `now()` at flush time, so
 * the exact behaviour the rule exists to reject — work through the checklist
 * offline in two minutes, close the app, turn the connection back on — would
 * sail through with a tidier request pattern than before.
 *
 * So: an attestation that does not land is gone. Not queued, not retried, not
 * remembered as pending. The module is marked as having failed to attest, the
 * checklist shows it as not counting, and the user is told immediately, while
 * they still have the day to fix it.
 *
 * If you are here to add a retry because a user complained about a lost day:
 * the fix is a longer `day_grace_hours` on the season, or turning
 * `require_live_writes` off for it. Not a queue. A queue is the loophole.
 *
 * ## Why the app has to be in the foreground
 *
 * "Live on the app" means exactly that. Background writes exist — a widget tap
 * routes through drizzle and is deliberately observed (see
 * `database/write-observer.ts`) — and crediting one would mean a day earned
 * without the app ever being opened. `AppState` is checked at call time rather
 * than trusted from a subscription, because this runs on the write path and
 * the write path is where a stale cached value would be wrong.
 *
 * ## Why sync pulls cannot reach here
 *
 * They already cannot. The sync engine writes through `getRawDb()`, never
 * drizzle, so the write observer never sees it — `write-observer.ts` explains
 * why that boundary exists and why it is load-bearing. Worth restating because
 * if it ever moved, signing in on a new phone would attest every module in the
 * challenge from a thousand rows of downloaded history.
 */

/**
 * Shortest gap between two attestations of the same module.
 *
 * This is on the write path of every module in the app, and a note editor
 * writing a row per debounced keystroke would otherwise be a request per
 * keystroke. Fifteen seconds is short enough that no realistic session gets
 * throttled to a stop and long enough that the storm case is bounded.
 *
 * It does interact with `challenge_seasons.min_writes`: a season demanding 3
 * writes per module needs ~30 seconds of genuine work in that module rather
 * than three rows saved in one burst. That is a defensible reading of
 * "min_writes" — the column's own comment calls it an anti-bot floor, not an
 * effort test — but it is a real behaviour change if anybody ever raises the
 * default of 1, so it is written down here rather than discovered later.
 */
const MIN_GAP_MS = 15_000;

/** Last attempt per module, in this process. Not persisted: a cold start
 *  attesting once more than strictly needed is free, and a persisted gate
 *  would be one more thing that can wrongly suppress a real attestation. */
const lastAttemptAt = new Map<string, number>();

/**
 * Whether an attestation should be attempted for this module right now.
 *
 * Pure and exported for its test. Everything this decides is cheap to get
 * wrong in a way that is invisible at runtime — a gate that always returns
 * false means a streak that silently never counts — so it is checked directly
 * rather than through the caller.
 */
export function shouldAttest(input: {
  enrolled: boolean;
  signedIn: boolean;
  foreground: boolean;
  committed: string[];
  module: string;
  lastAt: number | undefined;
  now: number;
}): boolean {
  if (!input.enrolled || !input.signedIn || !input.foreground) return false;
  // A module nobody committed to cannot affect a day, and the server refuses
  // it anyway — checking here saves the round trip rather than changing the
  // outcome.
  if (!input.committed.includes(input.module)) return false;
  if (input.lastAt !== undefined && input.now - input.lastAt < MIN_GAP_MS) return false;
  return true;
}

/**
 * Offers one witnessed write to the server. Fire-and-forget, never throws.
 *
 * The result is recorded in the store so the checklist can distinguish "ticked
 * on this phone" from "ticked, and the server saw it" — see
 * `challenge_live_today()` in 0065 for why that distinction has to be visible
 * rather than discovered at midnight.
 */
export function attestChallengeWrite(module: string): void {
  if (!isSupabaseConfigured) return;

  const store = useChallengeStore.getState();
  const now = Date.now();

  if (
    !shouldAttest({
      enrolled: store.enrolled,
      signedIn: !!useAuthStore.getState().user?.id,
      foreground: AppState.currentState === 'active',
      committed: store.required,
      module,
      lastAt: lastAttemptAt.get(module),
      now,
    })
  ) {
    return;
  }

  lastAttemptAt.set(module, now);

  void (async () => {
    try {
      const { data, error } = await supabase.rpc('attest_challenge_write', {
        p_module: module,
      });
      if (error) throw new Error(error.message);

      const result = (data ?? {}) as { ok?: boolean; localDay?: string };
      if (result.ok === true && result.localDay) {
        useChallengeStore.getState().markAttested(module, result.localDay);
      }
    } catch {
      // Gone, on purpose. See this file's header before adding a retry.
      //
      // Recorded only so the UI can say so: the user needs to know this write
      // did not count *now*, while redoing it online is still an option.
      useChallengeStore.getState().markAttestFailed(module);
      // Cleared so the next write in this module tries again immediately
      // rather than waiting out the gap — a user who has just reconnected
      // should not have their first action silently swallowed too.
      lastAttemptAt.delete(module);
    }
  })();
}

/** Drops the in-process gate. For tests, and for sign-out, where the next
 *  account must not inherit this one's timings. */
export function resetLiveWriteGate(): void {
  lastAttemptAt.clear();
}
