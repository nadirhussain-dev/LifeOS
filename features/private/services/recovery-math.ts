import { differenceInCalendarDays } from 'date-fns/differenceInCalendarDays';
import { parseISO } from 'date-fns/parseISO';

/**
 * Streaks and urge patterns for the Recovery module.
 *
 * One module, many habits. The same urge → trigger → outcome model serves
 * porn, masturbation, alcohol, smoking, vaping and gambling, which is why this
 * is not a "quit masturbating" tracker: identical code, a far larger audience,
 * useful to every gender, and it puts no embarrassing word in a module list
 * somebody might glance at.
 *
 * The design rule throughout is that a relapse is data, not a verdict. Nothing
 * here resets a total, scolds, or treats a bad day as erasing the work — that
 * framing is what makes people delete this kind of app instead of using it.
 */

export type RecoveryTarget =
  'porn' | 'masturbation' | 'alcohol' | 'smoking' | 'vaping' | 'gambling' | 'other';

export type UrgeOutcome = 'resisted' | 'relapsed';

export const TRIGGERS = [
  'stress',
  'boredom',
  'loneliness',
  'tired',
  'anxious',
  'celebration',
  'social',
  'lateNight',
] as const;

export type Trigger = (typeof TRIGGERS)[number];

export type RecoveryFields = {
  target: RecoveryTarget;
  /** `YYYY-MM-DD`. */
  date: string;
  outcome: UrgeOutcome;
  /** 1–5. How strong it felt, recorded whichever way it went. */
  intensity: number;
  triggers: Trigger[];
  note: string;
};

export type RecoveryEntry = RecoveryFields & {
  id: string;
  createdAt: number;
  updatedAt: number;
};

export type RecoveryStats = {
  /** Days since the last relapse. Null when there has never been one — which
   * reads as "no relapses recorded", not as a zero. */
  currentStreak: number | null;
  longestStreak: number;
  resisted: number;
  relapsed: number;
  /** Triggers ordered by how often they preceded a relapse. The actionable
   * number: it tells somebody what to plan around. */
  topRelapseTriggers: { trigger: Trigger; count: number }[];
};

const toDate = (date: string) => parseISO(date);

export function statsFor(
  entries: RecoveryEntry[],
  target: RecoveryTarget,
  now = new Date(),
): RecoveryStats {
  const mine = entries
    .filter((e) => e.target === target)
    .sort((a, b) => a.date.localeCompare(b.date));

  const relapses = mine.filter((e) => e.outcome === 'relapsed');
  const resisted = mine.length - relapses.length;

  const currentStreak =
    relapses.length === 0
      ? null
      : Math.max(0, differenceInCalendarDays(now, toDate(relapses[relapses.length - 1].date)));

  // Longest clean run: the widest gap between consecutive relapses, plus the
  // run still in progress.
  let longestStreak = 0;
  for (let i = 1; i < relapses.length; i += 1) {
    const gap = differenceInCalendarDays(toDate(relapses[i].date), toDate(relapses[i - 1].date));
    if (gap > longestStreak) longestStreak = gap;
  }
  if (currentStreak !== null && currentStreak > longestStreak) longestStreak = currentStreak;
  // Never relapsed: the streak runs from the first thing they logged.
  if (relapses.length === 0 && mine.length > 0) {
    longestStreak = Math.max(0, differenceInCalendarDays(now, toDate(mine[0].date)));
  }

  const counts = new Map<Trigger, number>();
  for (const relapse of relapses) {
    for (const trigger of relapse.triggers) {
      counts.set(trigger, (counts.get(trigger) ?? 0) + 1);
    }
  }

  const topRelapseTriggers = [...counts.entries()]
    .map(([trigger, count]) => ({ trigger, count }))
    .sort((a, b) => b.count - a.count || a.trigger.localeCompare(b.trigger))
    .slice(0, 3);

  return {
    currentStreak,
    longestStreak,
    resisted,
    relapsed: relapses.length,
    topRelapseTriggers,
  };
}

/** Which targets this person actually uses, so the screen shows their own list
 * rather than all seven. */
export function activeTargets(entries: RecoveryEntry[]): RecoveryTarget[] {
  return [...new Set(entries.map((e) => e.target))];
}
