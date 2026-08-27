import { addMonths } from 'date-fns/addMonths';
import { addWeeks } from 'date-fns/addWeeks';
import { addYears } from 'date-fns/addYears';
import { format } from 'date-fns/format';
import { isAfter } from 'date-fns/isAfter';
import { parseISO } from 'date-fns/parseISO';

/**
 * Which occurrences of a recurring transaction are owed.
 *
 * Recurring bills are the other half of what separates a budget from a spend
 * log: rent and a subscription are known in advance, and re-entering them every
 * month is the chore that makes people stop entering anything.
 *
 * Pure, because the failure modes here are all silent. A rule that posts twice
 * doubles somebody's rent in their own records; a rule that posts nothing looks
 * exactly like a rule that was never due.
 */

export type RecurringFrequency = 'weekly' | 'monthly' | 'yearly';

export type RecurringRule = {
  frequency: RecurringFrequency;
  /** "Every N". Clamped at read time — see `safeInterval`. */
  interval: number;
  /** `yyyy-MM-dd` of the first occurrence. */
  anchorDate: string;
  /** `yyyy-MM-dd` of the most recent occurrence already written, or null. */
  lastPostedDate: string | null;
  isActive: boolean;
};

/**
 * How far back a single catch-up will reach.
 *
 * Someone who reinstalls after a year should not find twelve months of invented
 * rent in their ledger — the transactions never happened as far as their actual
 * bank account is concerned, and a budget filled with plausible fiction is worse
 * than one with a gap. Two months is roughly "you were away and came back".
 */
const MAX_CATCHUP_OCCURRENCES = 8;

/** A rule out of the database is not a rule anyone typed. An interval of 0
 *  generates the same date forever, which is an infinite loop with a database
 *  write in it. */
function safeInterval(interval: number): number {
  return Number.isFinite(interval) && interval >= 1 ? Math.floor(interval) : 1;
}

/**
 * The `index`-th occurrence, measured from the anchor.
 *
 * Indexed from the anchor rather than stepped from the previous occurrence, and
 * that is the whole correctness story for month-end rules. Stepping compounds
 * the clamp: rent anchored on the 31st goes 31 Jan → 28 Feb, and the next step
 * is then taken from the 28th, so it becomes the 28th of every month
 * afterwards and never returns to the 31st. Indexing re-derives each occurrence
 * from the original day-of-month, so the same rule gives 31 Jan, 28 Feb,
 * 31 Mar — clamped where it must be and correct everywhere else.
 */
function occurrenceAt(
  anchor: Date,
  frequency: RecurringFrequency,
  interval: number,
  index: number,
): Date {
  const steps = interval * index;
  switch (frequency) {
    case 'weekly':
      return addWeeks(anchor, steps);
    case 'monthly':
      return addMonths(anchor, steps);
    case 'yearly':
      return addYears(anchor, steps);
  }
}

/**
 * Every occurrence date owed as of `today`, oldest first.
 */
export function dueOccurrences(rule: RecurringRule, today: Date): string[] {
  if (!rule.isActive) return [];

  const interval = safeInterval(rule.interval);
  const anchor = parseISO(rule.anchorDate);
  if (Number.isNaN(anchor.getTime())) return [];

  const due: string[] = [];
  const lastPosted = rule.lastPostedDate ? parseISO(rule.lastPostedDate) : null;

  // Bounded rather than unbounded: a corrupt anchor far in the past with a
  // weekly cadence is otherwise thousands of iterations before the date check
  // catches up.
  for (let index = 0; index < 5000; index += 1) {
    const occurrence = occurrenceAt(anchor, rule.frequency, interval, index);
    if (isAfter(occurrence, today)) break;

    // Strictly after the last posted date, so re-running on the same day cannot
    // post the same occurrence twice.
    if (!lastPosted || isAfter(occurrence, lastPosted)) {
      due.push(format(occurrence, 'yyyy-MM-dd'));
    }
  }

  // Keep the most recent, not the oldest: if only some can be posted, the ones
  // that matter to this month's budget are the recent ones.
  return due.slice(-MAX_CATCHUP_OCCURRENCES);
}

/**
 * The next date this rule will fire after `from`, for display.
 *
 * Separate from `dueOccurrences` because "when is rent next due" is a question
 * about the future and that function only answers questions about the past.
 */
export function nextOccurrence(rule: RecurringRule, from: Date): string | null {
  if (!rule.isActive) return null;

  const interval = safeInterval(rule.interval);
  const anchor = parseISO(rule.anchorDate);
  if (Number.isNaN(anchor.getTime())) return null;

  for (let index = 0; index < 5000; index += 1) {
    const occurrence = occurrenceAt(anchor, rule.frequency, interval, index);
    if (isAfter(occurrence, from)) return format(occurrence, 'yyyy-MM-dd');
  }
  return null;
}

/**
 * The id a materialized occurrence gets.
 *
 * Derived from the rule and the date, exactly like the join tables' ids and for
 * the same reason: two devices that both catch up while offline compute the same
 * id, and the upsert collapses them instead of posting the rent twice. This is
 * what makes materializing replay-proof rather than merely careful.
 */
export function occurrenceTransactionId(ruleId: string, date: string): string {
  return `recurring:${ruleId}:${date}`;
}

/** Exposed for the test that pins the catch-up bound. */
export const CATCHUP_LIMIT = MAX_CATCHUP_OCCURRENCES;
