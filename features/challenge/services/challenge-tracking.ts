import { setWriteObserver } from '@/database/write-observer';
import { moduleForTable } from '@/features/challenge/config/write-attribution';
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
    if (module) recordChallengeWrite(module);
  });
  return () => setWriteObserver(null);
}
