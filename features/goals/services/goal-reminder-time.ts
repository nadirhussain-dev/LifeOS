import type { GoalReminderSettings } from '@/features/goals/store/goal-reminder-store';

/**
 * The moment a goal's deadline reminder should fire.
 *
 * Its own module, with no repository imports, so it can be tested without
 * dragging SQLite into the test process — the same reason `habit-streaks` and
 * `split-math` are separate from their repositories.
 *
 * Built from the local calendar day rather than by subtracting milliseconds from
 * the deadline, for two reasons. "Three days before, at 9am" has to mean 9am on
 * that day, not whatever time of day the due date happens to carry — a goal
 * created at 23:40 would otherwise remind at 23:40. And subtracting raw
 * milliseconds drifts by an hour across a daylight-saving boundary, which is
 * exactly the kind of bug that shows up twice a year and is blamed on the phone.
 */
export function reminderTime(dueDate: number, settings: GoalReminderSettings): number {
  const target = new Date(dueDate);
  // setDate handles month and year underflow itself: the 2nd of March minus
  // seven days is the 23rd of February, and in a leap year the 24th.
  target.setDate(target.getDate() - settings.daysBefore);
  target.setHours(settings.hour, settings.minute, 0, 0);
  return target.getTime();
}
