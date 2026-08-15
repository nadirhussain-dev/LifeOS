import { setHours, setMinutes, setSeconds, startOfDay } from 'date-fns';

import { useChallengeStore } from '@/features/challenge/store/challenge-store';
import i18n from '@/lib/i18n';
import { cancelNotification, scheduleOneTimeNotification } from '@/lib/notifications';

/**
 * The at-risk reminder, and why it is re-scheduled rather than scheduled.
 *
 * The `'streak'` notification category has existed since the notifications
 * backbone shipped and has never had a scheduler behind it. TODO.md leaves it
 * unchecked "by design", and the reason given there is correct: a local
 * notification cannot evaluate anything at fire time, so a reminder scheduled
 * this morning cannot know whether the day was finished this afternoon. Firing
 * "you are about to lose your streak" at somebody who finished at lunchtime is
 * worse than not firing at all — it is the notification that gets the whole
 * category turned off.
 *
 * The way out is not a smarter trigger, it is a cheaper one. The app knows the
 * checklist state every time it changes, so the reminder is **cancelled and
 * re-scheduled on every write**, carrying the modules that are still
 * outstanding in its body. When the last one lands, it is cancelled outright
 * and nothing fires. Same shape as `syncDebtReminder`, for the same reason: a
 * schedule that is rebuilt from current state cannot drift from it.
 *
 * The text names what is missing rather than warning in general. "Journal not
 * logged" is something somebody can act on in fifteen seconds; "your streak is
 * at risk" is something they have to go and investigate, and mostly will not.
 */

/** Fixed hour, late enough to be a last call and early enough to be actionable. */
const REMINDER_HOUR = 20;

/** Where the id is kept. Not a database column: this is bookkeeping about one
 *  phone's queue, exactly like `notification_log`, and it must not sync. */
let scheduledId: string | null = null;

/** The moment today's reminder should fire, or null if that moment has passed. */
export function atRiskReminderDate(now: Date = new Date()): number | null {
  const fireAt = setSeconds(setMinutes(setHours(startOfDay(now), REMINDER_HOUR), 0), 0).getTime();
  return fireAt > now.getTime() ? fireAt : null;
}

/**
 * Brings the pending reminder in line with what is still outstanding today.
 *
 * Called after anything that could change the answer. Cheap enough to call on
 * every write: cancelling and re-queueing one local notification costs nothing,
 * and the alternative — trying to be clever about when it is worth updating —
 * is how the schedule drifts out of step with the checklist.
 */
export async function syncChallengeReminder(outstanding: string[]): Promise<void> {
  await cancelNotification(scheduledId);
  scheduledId = null;

  if (!useChallengeStore.getState().enrolled) return;
  // Nothing outstanding means the day is done, or as done as this phone can
  // tell. Either way there is nothing to warn about.
  if (outstanding.length === 0) return;

  const fireAt = atRiskReminderDate();
  if (fireAt === null) return;

  const modules = outstanding.map((id) => i18n.t(`syncModule.${id}`)).join(', ');

  scheduledId = await scheduleOneTimeNotification({
    title: i18n.t('challenge.reminderTitle'),
    body: i18n.t('challenge.reminderOne', { modules }),
    date: fireAt,
    // `bypassQuietHours` is true for this category — a last call at 20:00 that
    // quiet hours swallowed would be a reminder that only ever fires for people
    // who did not need it.
    data: { category: 'streak', route: '/challenge' },
  });
}

/** Drops the pending reminder — on sign-out, or on leaving a run. */
export async function cancelChallengeReminder(): Promise<void> {
  await cancelNotification(scheduledId);
  scheduledId = null;
}
