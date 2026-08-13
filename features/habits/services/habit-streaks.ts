import { addDays, differenceInCalendarDays, getDay, parseISO, subDays } from 'date-fns';

import { toDateKey } from '@/lib/date';
import type {
  Habit,
  HabitLog,
  HabitSkip,
  HabitStreakSummary,
  HabitTodayStatus,
} from '@/features/habits/types/habit.types';

export { toDateKey } from '@/lib/date';

const MAX_STREAK_LOOKBACK_DAYS = 3650;

type ScheduleHabit = Pick<
  Habit,
  'scheduleType' | 'scheduleDays' | 'scheduleIntervalDays' | 'createdAt'
>;

/**
 * Whether a habit is expected on a given day. 'weekly' | 'monthly' | 'flexible'
 * deliberately resolve to "every day counts" for streak purposes — cadence-aware
 * weekly/monthly bucketing (e.g. "3 of 7 days this week") is a real behavioral
 * difference worth building, but is future extensibility, not Phase 1 scope.
 */
export function isHabitScheduledOn(habit: ScheduleHabit, dateKey: string): boolean {
  if (habit.scheduleType === 'custom_days') {
    const dow = getDay(parseISO(dateKey));
    return (habit.scheduleDays ?? []).includes(dow);
  }
  if (habit.scheduleType === 'every_x_days') {
    const interval = habit.scheduleIntervalDays ?? 1;
    const anchor = toDateKey(new Date(habit.createdAt));
    const days = differenceInCalendarDays(parseISO(dateKey), parseISO(anchor));
    return days >= 0 && days % interval === 0;
  }
  return true;
}

function indexByDate<T extends { logDate: string }>(rows: T[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const row of rows) map.set(row.logDate, row);
  return map;
}

export function getTodayStatus(
  habit: ScheduleHabit,
  logs: HabitLog[],
  skips: HabitSkip[],
  todayKey: string,
): HabitTodayStatus {
  if (!isHabitScheduledOn(habit, todayKey)) return 'not_scheduled';
  const logsByDate = indexByDate(logs);
  const skipsByDate = indexByDate(skips);
  if (logsByDate.has(todayKey)) return 'done';
  if (skipsByDate.has(todayKey)) return 'skipped';
  return 'not_yet';
}

/**
 * Derives current streak, best streak, and 30-day completion rate from raw
 * logs/skips. Nothing is stored — recomputed on read so editing or backfilling
 * a past log never requires a separate "resync streak" step.
 */
export function calculateHabitStreaks(
  habit: ScheduleHabit,
  logs: HabitLog[],
  skips: HabitSkip[],
  asOf: Date = new Date(),
): HabitStreakSummary {
  const logsByDate = indexByDate(logs);
  const skipsByDate = indexByDate(skips);

  // Current streak: walk back from today, stop at the SECOND real miss. Today
  // hasn't-happened-yet and excused skips are transparent (neither break nor
  // extend). Counts logged days in the run ending at/just-before today.
  //
  // The grace day is deliberate. A streak that resets to zero on one bad day is
  // pure loss aversion: it punishes hardest exactly when someone is ill, busy or
  // travelling, and the reliable result is that they stop opening the app rather
  // than resume the habit. One forgiven miss keeps the thing it is actually
  // measuring — the shape of a routine — without pretending the day happened.
  // The miss is not counted, only survived, and `graceUsed` says so out loud.
  let currentStreak = 0;
  let graceUsed = false;
  {
    let run = 0;
    let missed = 0;
    let cursor = asOf;
    let isToday = true;
    // Days before the habit's first-ever log are not misses — there was nothing
    // to do yet. Without this the walk runs off the start of history and spends
    // the grace day there, which both mislabels healthy streaks as "grace used"
    // and, worse, would let two empty days extend a run.
    const earliestLog = logs.reduce(
      (min, l) => Math.min(min, parseISO(l.logDate).getTime()),
      asOf.getTime(),
    );
    for (let i = 0; i < MAX_STREAK_LOOKBACK_DAYS; i += 1) {
      if (cursor.getTime() < earliestLog) break;
      const dateKey = toDateKey(cursor);
      if (isHabitScheduledOn(habit, dateKey)) {
        if (logsByDate.has(dateKey)) run += 1;
        else if (skipsByDate.has(dateKey)) {
          // excused
        } else if (isToday) {
          // pending — not a miss
        } else {
          missed += 1;
          if (missed > 1) break;
          // A run that hasn't started has nothing to protect: spending the
          // grace day here would invent a streak out of empty days.
          if (run === 0) break;
          graceUsed = true;
        }
      }
      isToday = false;
      cursor = subDays(cursor, 1);
    }
    currentStreak = run;
    if (run === 0) graceUsed = false;
  }

  // Best streak: full-history scan (no early break) from today back to the
  // earliest log, so an older longer run is found even after a recent lapse.
  let bestStreak = currentStreak;
  {
    let run = 0;
    let cursor = asOf;
    let isToday = true;
    const earliestLog = logs.reduce(
      (min, l) => Math.min(min, parseISO(l.logDate).getTime()),
      asOf.getTime(),
    );
    for (let i = 0; i < MAX_STREAK_LOOKBACK_DAYS; i += 1) {
      if (cursor.getTime() < earliestLog) break;
      const dateKey = toDateKey(cursor);
      if (isHabitScheduledOn(habit, dateKey)) {
        if (logsByDate.has(dateKey)) {
          run += 1;
          bestStreak = Math.max(bestStreak, run);
        } else if (skipsByDate.has(dateKey)) {
          // excused
        } else if (isToday) {
          // pending
        } else run = 0;
      }
      isToday = false;
      cursor = subDays(cursor, 1);
    }
  }

  const windowStart = subDays(asOf, 29);
  let scheduledDays = 0;
  let completedDays = 0;
  for (let cursorDate = windowStart; cursorDate <= asOf; cursorDate = addDays(cursorDate, 1)) {
    const dateKey = toDateKey(cursorDate);
    if (!isHabitScheduledOn(habit, dateKey)) continue;
    if (skipsByDate.has(dateKey)) continue;
    scheduledDays += 1;
    if (logsByDate.has(dateKey)) completedDays += 1;
  }

  return {
    currentStreak,
    bestStreak: Math.max(bestStreak, currentStreak),
    completionRate30d: scheduledDays === 0 ? 1 : completedDays / scheduledDays,
    graceUsed,
  };
}

export type HabitLevel = { tier: number; nameKey: string };

/**
 * Named tiers for the current streak — the one gamified "hook" the habits
 * module gets, deliberately small: a title that escalates, not points, coins
 * or a shop. Based on `currentStreak` rather than `bestStreak` so the level
 * can be lost, the same honesty the grace-day mechanic above already commits
 * to — a badge that can never go down isn't really a level.
 *
 * 66 days for "Blaze" isn't an arbitrary round number — it's the commonly
 * cited average time for a habit to become automatic.
 */
const HABIT_LEVELS: HabitLevel[] = [
  { tier: 6, nameKey: 'habits.levelLegend' },
  { tier: 5, nameKey: 'habits.levelWildfire' },
  { tier: 4, nameKey: 'habits.levelBlaze' },
  { tier: 3, nameKey: 'habits.levelFlame' },
  { tier: 2, nameKey: 'habits.levelEmber' },
  { tier: 1, nameKey: 'habits.levelSpark' },
];
const HABIT_LEVEL_THRESHOLD_DAYS = [365, 180, 66, 21, 7, 3];

export function habitLevelForStreak(currentStreak: number): HabitLevel | null {
  const index = HABIT_LEVEL_THRESHOLD_DAYS.findIndex((days) => currentStreak >= days);
  return index === -1 ? null : HABIT_LEVELS[index];
}
