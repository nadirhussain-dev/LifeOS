import { differenceInCalendarDays } from 'date-fns/differenceInCalendarDays';
import { parseISO } from 'date-fns/parseISO';

import type { Period } from '@/features/private/services/cycle-math';
import type { IntimacyEntry } from '@/features/private/services/intimacy';
import {
  activeTargets,
  statsFor,
  type RecoveryEntry,
  type RecoveryTarget,
} from '@/features/private/services/recovery-math';

/**
 * Cross-time aggregation for the "Insights" screen — the Plus feature built
 * on top of data every free account already logs. Pure functions over what
 * cycle.ts/recovery.ts/intimacy.ts already return, same split as
 * cycle-math.ts and recovery-math.ts: testable without a screen, a decrypted
 * row, or a plan check anywhere near them. The plan gate belongs entirely to
 * the screen that renders this, not to any function here.
 */

/**
 * Individual cycle lengths (gap between consecutive period starts), oldest
 * first, capped to the most recent `max`. `averageCycleLength`
 * (cycle-math.ts) collapses this same data to one number; this keeps it
 * split out so a trend — lengthening, shortening, steady — is visible
 * rather than only its mean. Same implausible-gap filter (a mistyped year)
 * that function already applies.
 */
export function cycleLengthTrend(periods: Period[], max = 6): number[] {
  const starts = [...periods].map((p) => p.start).sort();
  const gaps: number[] = [];
  for (let i = 1; i < starts.length; i += 1) {
    const gap = differenceInCalendarDays(parseISO(starts[i]), parseISO(starts[i - 1]));
    if (gap >= 15 && gap <= 60) gaps.push(gap);
  }
  return gaps.slice(-max);
}

export type RecoverySummaryRow = {
  target: RecoveryTarget;
  resisted: number;
  relapsed: number;
  currentStreak: number | null;
};

/** One row per target this person actually logs, not all seven — mirrors
 *  recovery.tsx's own reasoning for using `activeTargets`. */
export function recoverySummary(entries: RecoveryEntry[]): RecoverySummaryRow[] {
  return activeTargets(entries).map((target) => {
    const stats = statsFor(entries, target);
    return {
      target,
      resisted: stats.resisted,
      relapsed: stats.relapsed,
      currentStreak: stats.currentStreak,
    };
  });
}

export type MoodTrend = {
  recentAverage: number | null;
  priorAverage: number | null;
  /** null when there isn't a full prior window to compare against yet. */
  improving: boolean | null;
};

/**
 * Mean mood over the most recent `windowSize` logged entries against the
 * `windowSize` before that — enough to say "trending up" without claiming
 * anything about a single day.
 */
export function intimacyMoodTrend(entries: IntimacyEntry[], windowSize = 5): MoodTrend {
  const withMood = entries
    .filter((e): e is IntimacyEntry & { mood: number } => e.mood !== null)
    .sort((a, b) => a.date.localeCompare(b.date));

  const average = (rows: { mood: number }[]) =>
    rows.length === 0 ? null : rows.reduce((sum, r) => sum + r.mood, 0) / rows.length;

  const recentAverage = average(withMood.slice(-windowSize));
  const priorAverage = average(withMood.slice(-windowSize * 2, -windowSize));

  return {
    recentAverage,
    priorAverage,
    improving:
      recentAverage !== null && priorAverage !== null ? recentAverage > priorAverage : null,
  };
}
