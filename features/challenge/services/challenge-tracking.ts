import { setWriteObserver } from '@/database/write-observer';
import { moduleForTable } from '@/features/challenge/config/write-attribution';
import { attestChallengeWrite } from '@/features/challenge/services/live-writes';
import { recordChallengeWrite } from '@/features/challenge/store/challenge-store';

/**
 * Connects the database's write observer to the challenge buffer.
 *
 * The two halves are kept apart on purpose: `database/write-observer.ts` knows
 * that a row changed in a table and nothing about streaks, and the store knows
 * about streaks and nothing about SQL. This file is the only place that has to
 * know both, which is what keeps `database/` free of any dependency on a
 * feature.
 *
 * Returns its own teardown so a test can install and remove it without leaving
 * a global observer behind for whatever runs next.
 */
export function startChallengeWriteTracking(): () => void {
  setWriteObserver((table) => {
    const module = moduleForTable(table);
    if (!module) return;
    // Two recipients, and they answer different questions. The buffer is what
    // this phone believes it did, and it draws the checklist instantly with no
    // network in the way. The attestation is what the *server* witnessed, and
    // under a season with `require_live_writes` (0065) it is the only one that
    // can credit a day.
    //
    // The local record happens first and unconditionally: even a write that
    // cannot be attested — offline, backgrounded, signed out — is still work
    // the user did, and the checklist showing it is what makes the "this did
    // not count" state legible rather than baffling.
    recordChallengeWrite(module);
    attestChallengeWrite(module);
  });
  return () => setWriteObserver(null);
}
