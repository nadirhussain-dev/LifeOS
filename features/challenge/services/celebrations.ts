import type { ChallengeEvent } from '@/features/challenge/hooks/use-challenge';

/**
 * Which events are worth saying something about, and where the watermark may
 * move to afterwards.
 *
 * The engine has always written these — `challenge_credit_day` records
 * `tier_reached`, `shield_earned` and `completed` on the very call that earns
 * them — and the app has never read any of them. Progress simply appeared in a
 * number on the next refetch, if the user happened to be looking. `demoted` was
 * the sole exception, and the only reason the event log was read at all.
 *
 * Derived from the log rather than from `record_challenge_day`'s response, even
 * though that response carries the same three flags. The flush runs in the
 * background, possibly with no screen mounted and possibly on a different
 * device from the one that earned the day; the log is durable and already has a
 * seen-watermark. A celebration that only fires if you happen to be holding the
 * phone at the moment the buffer flushes is not a celebration.
 *
 * ## Why this stops at a fall
 *
 * `lastSeenEventId` is one watermark shared with the demotion sheet, so
 * advancing past an unseen `demoted` would silently swallow it — the sheet
 * looks for exactly that event and would never find it. So the walk stops
 * there and leaves the fall, and everything after it, for the next pass. The
 * ordering is not arbitrary either: being told "you reached Ember" *after*
 * being told you fell off it is the wrong way round.
 */
const CELEBRATED = new Set(['tier_reached', 'shield_earned', 'completed', 'season_ended']);

/** Ends the walk rather than being celebrated — see above. */
const BLOCKING = 'demoted';

export type Celebrations = {
  /** Oldest first, which is the order they happened and the order to show. */
  show: ChallengeEvent[];
  /**
   * Where the seen-watermark may move to. Never past an unseen fall, and
   * unchanged when there is nothing to show, so this can be assigned
   * unconditionally.
   */
  watermark: number;
};

export function celebrationsFor(events: ChallengeEvent[], lastSeenEventId: number): Celebrations {
  // The query returns newest first; this walk is chronological.
  const unseen = events.filter((event) => event.id > lastSeenEventId).sort((a, b) => a.id - b.id);

  const show: ChallengeEvent[] = [];
  let watermark = lastSeenEventId;

  for (const event of unseen) {
    if (event.kind === BLOCKING) break;
    // Anything else unrecognised — `enrolled`, `module_swapped`, an operator
    // grant — is not worth a toast but is still "seen", so it does not wedge
    // the walk behind an event nothing will ever announce.
    if (CELEBRATED.has(event.kind)) show.push(event);
    watermark = event.id;
  }

  return { show, watermark };
}
