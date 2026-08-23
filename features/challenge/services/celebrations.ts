import type { ChallengeEvent } from '@/features/challenge/hooks/use-challenge';

/**
 * Which events are worth saying something about, where the watermark may move
 * to afterwards, and which one the walk stopped at.
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
 * ## Toasts, and the two things that are not toasts
 *
 * Most of these are worth a line and no more. Two are worth stopping for, and
 * both work the same way: the walk **halts** at them, leaving them and
 * everything after them unseen until a sheet has been acknowledged.
 *
 *   * `demoted` — the fall. `lastSeenEventId` is one watermark shared with the
 *     demotion sheet, so advancing past an unseen fall would silently swallow
 *     it: the sheet looks for exactly that event and would never find it.
 *   * `reward_granted` — the payout (0071). A rung that finally handed over a
 *     badge, a gradient and a week of Premium is the single best moment this
 *     programme has, and a toast that vanishes in three seconds while somebody
 *     is looking at their checklist is not what it is worth. Blocking also
 *     makes it *durable*: force-quitting on the sheet means seeing it next
 *     time, where a toast would simply have been missed.
 *
 * The ordering matters and falls out of the halt for free: being told "you
 * reached Ember" after being told you fell off it is the wrong way round, and
 * being congratulated on a payout immediately after a fall is worse.
 */
const CELEBRATED = new Set(['tier_reached', 'shield_earned', 'completed', 'season_ended']);

/** Ends the walk and is shown as a sheet instead — see above. */
const BLOCKING = new Set(['demoted', 'reward_granted']);

export type Celebrations = {
  /** Oldest first, which is the order they happened and the order to show. */
  show: ChallengeEvent[];
  /**
   * Where the seen-watermark may move to. Never past a blocking event, and
   * unchanged when there is nothing to show, so this can be assigned
   * unconditionally.
   */
  watermark: number;
  /**
   * The oldest unseen event that needs a sheet, or null.
   *
   * Returned from here rather than found again by the screen, so that "which
   * sheet, if any" has one answer. Two independent searches produced the bug
   * this replaced in waiting: a fall and a payout both unseen would each find
   * themselves, and two modals would race for the same surface.
   */
  blockedBy: ChallengeEvent | null;
};

export function celebrationsFor(events: ChallengeEvent[], lastSeenEventId: number): Celebrations {
  // The query returns newest first; this walk is chronological.
  const unseen = events.filter((event) => event.id > lastSeenEventId).sort((a, b) => a.id - b.id);

  const show: ChallengeEvent[] = [];
  let watermark = lastSeenEventId;
  let blockedBy: ChallengeEvent | null = null;

  for (const event of unseen) {
    if (BLOCKING.has(event.kind)) {
      blockedBy = event;
      break;
    }
    // Anything else unrecognised — `enrolled`, `module_swapped`, an operator
    // grant — is not worth a toast but is still "seen", so it does not wedge
    // the walk behind an event nothing will ever announce.
    if (CELEBRATED.has(event.kind)) show.push(event);
    watermark = event.id;
  }

  return { show, watermark, blockedBy };
}
