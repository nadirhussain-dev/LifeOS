import type { Goal } from '@/features/goals/types/goal.types';

/**
 * Turning finished work into goal progress.
 *
 * A goal that does not move when you do the work is a wish list, and manual
 * progress is why goal features get abandoned in a fortnight. Tasks and habits
 * can now name a goal, and finishing them advances it.
 *
 * ## Only count-mode goals
 *
 * `percent` goals hold a fraction the user set by hand: a finished task implies
 * nothing about what share of "get fit" is done, and inventing a number would
 * be the app overwriting the user's own judgement. `milestones` goals already
 * have a mechanism for discrete pieces of work — the milestones — and a second
 * one competing with it would make progress depend on which the user happened
 * to use.
 *
 * `count` goals are different: they hold an absolute number in a unit the user
 * named, so "one more" is a fact rather than a guess. The pickers offer only
 * count-mode goals, so this rule is visible in the UI instead of being a silent
 * no-op on a link the user thought they had made.
 */
export function canGoalReceiveContributions(goal: Pick<Goal, 'progressMode'>): boolean {
  return goal.progressMode === 'count';
}

/**
 * The goal's new `currentValue` after a contribution, and the delta actually
 * applied.
 *
 * The applied delta can differ from the requested one, and that is the point of
 * returning it: `currentValue` is floored at zero, so un-completing work that
 * would take a goal negative applies only the part that exists. Logging the
 * requested delta instead would leave the progress feed claiming a change the
 * goal never made, and the feed is the audit trail the chart is drawn from.
 */
export function applyContribution(
  goal: Pick<Goal, 'currentValue'>,
  requestedDelta: number,
): { value: number; delta: number } {
  if (!Number.isFinite(requestedDelta) || requestedDelta === 0) {
    return { value: goal.currentValue, delta: 0 };
  }
  const value = Math.max(0, goal.currentValue + requestedDelta);
  return { value, delta: value - goal.currentValue };
}

/**
 * What one habit log is worth to a goal.
 *
 * A boolean habit is one occurrence. A habit that measures something — count,
 * duration, distance — contributes what it measured, because a goal of "run
 * 100km" wants the kilometres, not the number of runs.
 *
 * Units are not checked, and cannot usefully be: the habit's unit is free text
 * and the goal's is too. The picker shows the goal's unit next to its name so
 * the person making the link is the one who decides they match, which is the
 * only place that judgement can honestly live.
 */
export function habitLogContribution(
  habitType: string,
  loggedValue: number | null | undefined,
): number {
  if (habitType === 'boolean' || habitType === 'negative') return 1;
  const value = loggedValue ?? 1;
  return Number.isFinite(value) && value > 0 ? value : 1;
}
