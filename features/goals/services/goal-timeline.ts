import { differenceInCalendarDays } from 'date-fns/differenceInCalendarDays';

import type {
  Goal,
  GoalMilestone,
  GoalProgressLog,
  GoalTimeline,
  ProgressPoint,
} from '@/features/goals/types/goal.types';

const PACE_TOLERANCE = 0.05;

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/** Converts a log's native value into a 0–1 fraction using the goal's mode. */
export function fractionFromValue(goal: Goal, value: number): number {
  if (goal.progressMode === 'count') {
    return goal.targetValue && goal.targetValue > 0 ? clamp01(value / goal.targetValue) : 0;
  }
  // percent + milestones already store a 0–1 fraction.
  return clamp01(value);
}

/**
 * Derives the time-bound picture of a goal: how far into its window we are, how
 * far a perfectly-paced goal would be by now, and whether the current progress
 * is ahead/on-track/behind — plus the daily pace required to still finish on
 * time. Start is the goal's creation; end is its due date. A goal with no due
 * date has no schedule, so pace is 'none'.
 */
export function goalTimeline(goal: Goal, progress: number, now = Date.now()): GoalTimeline {
  if (!goal.dueDate) {
    return {
      hasDeadline: false,
      isOverdue: false,
      totalDays: 0,
      dayNumber: 0,
      elapsedDays: 0,
      remainingDays: 0,
      expectedProgress: 0,
      pace: 'none',
      requiredPerDay: null,
    };
  }

  const start = goal.createdAt;
  const end = goal.dueDate;
  const totalDays = Math.max(1, differenceInCalendarDays(end, start));
  const elapsedRaw = differenceInCalendarDays(now, start);
  const elapsedDays = Math.max(0, Math.min(totalDays, elapsedRaw));
  const remainingDaysRaw = differenceInCalendarDays(end, now);
  const remainingDays = Math.max(0, remainingDaysRaw);
  const isOverdue = now > end && progress < 1;

  const expectedProgress = clamp01(elapsedRaw / totalDays);
  const diff = progress - expectedProgress;
  const pace = diff >= PACE_TOLERANCE ? 'ahead' : diff <= -PACE_TOLERANCE ? 'behind' : 'on_track';

  const remainingProgress = Math.max(0, 1 - progress);
  const requiredPerDay = remainingDaysRaw > 0 ? remainingProgress / remainingDaysRaw : null;

  return {
    hasDeadline: true,
    isOverdue,
    totalDays,
    dayNumber: Math.max(1, Math.min(totalDays, elapsedRaw + 1)),
    elapsedDays,
    remainingDays,
    expectedProgress,
    pace,
    requiredPerDay,
  };
}

/**
 * Builds the cumulative progress series (0–1 over time) for the chart. For
 * percent/count goals it walks the progress logs; for milestone goals it uses
 * each milestone's completion timestamp as a step. Always begins at the goal's
 * creation (0) and ends at "now" (current progress) so the line spans the full
 * window even before any updates.
 */
export function buildProgressSeries(
  goal: Goal,
  progress: number,
  logs: GoalProgressLog[],
  milestones: GoalMilestone[],
  now = Date.now(),
): ProgressPoint[] {
  const points: ProgressPoint[] = [{ t: goal.createdAt, v: 0 }];

  if (goal.progressMode === 'milestones') {
    const total = milestones.length;
    const completed = milestones
      .filter((m) => m.isCompleted && m.completedAt)
      .sort((a, b) => (a.completedAt ?? 0) - (b.completedAt ?? 0));
    completed.forEach((milestone, index) => {
      points.push({ t: milestone.completedAt!, v: total > 0 ? (index + 1) / total : 0 });
    });
  } else {
    [...logs]
      .sort((a, b) => a.loggedAt - b.loggedAt)
      .forEach((log) => points.push({ t: log.loggedAt, v: fractionFromValue(goal, log.value) }));
  }

  // Cap the series at "now" with the authoritative current progress.
  const last = points[points.length - 1];
  if (last.t < now || last.v !== progress) points.push({ t: now, v: progress });
  return points;
}

/** Per-day averages for the stats strip. */
export function progressStats(goal: Goal, progress: number, timeline: GoalTimeline) {
  const dailyAverage = timeline.elapsedDays > 0 ? progress / timeline.elapsedDays : progress;
  return {
    dailyAverage,
    requiredPerDay: timeline.requiredPerDay,
    onPace: timeline.pace === 'ahead' || timeline.pace === 'on_track',
  };
}
