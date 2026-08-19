import { addDays, addMonths, addWeeks, addYears, getDay } from 'date-fns';

import type {
  TaskRecurrenceAnchor,
  TaskRecurrenceFrequency,
} from '@/features/tasks/types/task.types';

/**
 * When a repeating task's next occurrence falls.
 *
 * Split out of `tasks-repository` because it is the half worth testing: the
 * repository's job is one INSERT, while every question that can actually be got
 * wrong — a fortnightly cycle, "Mon/Wed/Fri", the 31st of a 30-day month, a
 * chore due three days after you last did it — lives in this arithmetic.
 */
export type RecurrenceRule = {
  frequency: TaskRecurrenceFrequency;
  /** "Every N days/weeks/months/years". */
  interval: number;
  /** Weekly only: which weekdays the task repeats on, 0 = Sunday, matching
   *  `Date#getDay`, `Habit.scheduleDays` and `WeekdayPicker`. Null or empty
   *  means plain "every N weeks" from the anchor. */
  daysOfWeek: number[] | null;
  anchor: TaskRecurrenceAnchor;
};

/** A rule read out of the database is not a rule anyone typed — an interval of
 *  0 repeats forever on the same day, and a negative one walks backwards into
 *  an ever-growing pile of overdue clones. Both are cheap to refuse here and
 *  expensive to notice in the wild. */
function safeInterval(interval: number): number {
  return Number.isFinite(interval) && interval >= 1 ? Math.floor(interval) : 1;
}

/**
 * The completion day, at the due date's time of day.
 *
 * A completion-anchored task ("water the plants 3 days after I last did")
 * should follow the day you finished it, but not the *minute*: ticking a chore
 * off at 11:48pm must not move it to 11:48pm forever. The calendar day comes
 * from the completion, the clock comes from the original due date.
 */
function completionDayAtDueTime(dueDate: number, completedAt: number): number {
  const due = new Date(dueDate);
  const done = new Date(completedAt);
  done.setHours(due.getHours(), due.getMinutes(), due.getSeconds(), due.getMilliseconds());
  return done.getTime();
}

/**
 * The next selected weekday strictly after `from`.
 *
 * `interval` applies to the *wrap*, not to each day: "every 2 weeks on Mon and
 * Thu" means both days of one week, then a fortnight's gap — not Monday, skip,
 * Thursday, skip.
 */
function nextSelectedWeekday(from: number, interval: number, daysOfWeek: number[]): number {
  const selected = [
    ...new Set(daysOfWeek.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)),
  ].sort((a, b) => a - b);
  if (selected.length === 0) return addWeeks(new Date(from), interval).getTime();

  const fromDow = getDay(new Date(from));
  const laterThisWeek = selected.find((d) => d > fromDow);
  if (laterThisWeek !== undefined)
    return addDays(new Date(from), laterThisWeek - fromDow).getTime();

  // Past the last selected day of this week, so wrap to the first selected day
  // `interval` weeks on.
  return addDays(new Date(from), interval * 7 - (fromDow - selected[0])).getTime();
}

/**
 * The due date of the occurrence that replaces a completed repeating task, or
 * null if the task does not repeat.
 *
 * Month and year arithmetic is date-fns', which clamps rather than overflows:
 * the 31st repeating monthly lands on the 30th, or the 28th, instead of
 * skidding into the following month and drifting a day further every time.
 */
export function nextRecurrenceDueDate(
  rule: RecurrenceRule,
  dueDate: number,
  completedAt: number,
): number | null {
  if (rule.frequency === 'none') return null;

  const interval = safeInterval(rule.interval);
  const from =
    rule.anchor === 'completion' ? completionDayAtDueTime(dueDate, completedAt) : dueDate;

  switch (rule.frequency) {
    case 'daily':
      return addDays(new Date(from), interval).getTime();
    case 'weekly':
      return rule.daysOfWeek && rule.daysOfWeek.length > 0
        ? nextSelectedWeekday(from, interval, rule.daysOfWeek)
        : addWeeks(new Date(from), interval).getTime();
    case 'monthly':
      return addMonths(new Date(from), interval).getTime();
    case 'yearly':
      return addYears(new Date(from), interval).getTime();
  }
}

/** Every weekday — the preset behind "Weekdays", stored as ordinary selected
 *  days so nothing downstream needs a special case for it. */
export const WEEKDAY_PRESET = [1, 2, 3, 4, 5];
