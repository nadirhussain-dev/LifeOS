import { setHours, setMinutes, setSeconds, startOfDay } from 'date-fns';

import { costOfMissToday } from '@/features/challenge/services/challenge-math';
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
 *
 * ## Two reminders, not one, and only for the people with something to lose
 *
 * The 20:00 nudge is the last call while there is still an evening left. It now
 * carries the *price* as well as the list, because `demotionTarget()` has been
 * able to compute that number since 0048 and nothing has ever shown it to
 * anybody — "Journal and Water not logged" and "missing today drops you from 84
 * days to 60" are the same fact and not the same message.
 *
 * The 22:00 one exists only for somebody holding **no shields**, because they
 * are the only people for whom tonight is genuinely irreversible. Sending it to
 * everybody would be a second evening notification for a population whose miss
 * costs them a buffer they will earn back, which is how a category gets turned
 * off — and turning this category off costs the 20:00 reminder too.
 *
 * Both are cancelled outright the moment the day is complete, so neither can
 * fire at somebody who has already finished.
 */

/** Fixed hour, late enough to be a last call and early enough to be actionable. */
const REMINDER_HOUR = 20;

/**
 * The second call, for people with no shield left.
 *
 * Late enough to be the last word on the day and early enough that fifteen
 * minutes of work is still possible. Past this there is nothing useful to say:
 * a notification at 23:50 about a day that ends at midnight is an accusation,
 * not a reminder.
 */
const LAST_CALL_HOUR = 22;

/** Where the ids are kept. Not database columns: this is bookkeeping about one
 *  phone's queue, exactly like `notification_log`, and it must not sync. */
let scheduledId: string | null = null;
let lastCallId: string | null = null;

/** The moment a reminder at `hour` should fire, or null if it has passed. */
function fireAtHour(hour: number, now: Date): number | null {
  const at = setSeconds(setMinutes(setHours(startOfDay(now), hour), 0), 0).getTime();
  return at > now.getTime() ? at : null;
}

/** The moment today's reminder should fire, or null if that moment has passed. */
export function atRiskReminderDate(now: Date = new Date()): number | null {
  return fireAtHour(REMINDER_HOUR, now);
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
  await cancelNotification(lastCallId);
  scheduledId = null;
  lastCallId = null;

  const state = useChallengeStore.getState();
  if (!state.enrolled) return;
  // Nothing outstanding means the day is done, or as done as this phone can
  // tell. Either way there is nothing to warn about — and somebody who has just
  // kept a day has already answered the question a pending win-back was going
  // to ask them in two days' time.
  if (outstanding.length === 0) {
    await cancelWinBack();
    return;
  }

  const modules = outstanding.map((id) => i18n.t(`syncModule.${id}`)).join(', ');
  const cost = costOfMissToday(state.standing);
  const now = new Date();

  // The body says what is missing and, when there is an honest number for it,
  // what missing them costs. `costOfMissToday` returns null rather than zero
  // whenever a number would mislead — a held shield, or a ladder the server has
  // not sent yet — and the copy branches instead of interpolating a zero.
  const body =
    cost !== null
      ? i18n.t('challenge.reminderCost', {
          modules,
          count: cost,
          from: state.standing.qualifiedDays,
          to: state.standing.qualifiedDays - cost,
        })
      : state.standing.shields > 0
        ? i18n.t('challenge.reminderShielded', { modules })
        : i18n.t('challenge.reminderOne', { modules });

  const fireAt = fireAtHour(REMINDER_HOUR, now);
  if (fireAt !== null) {
    scheduledId = await scheduleOneTimeNotification({
      title: i18n.t('challenge.reminderTitle'),
      body,
      date: fireAt,
      // `bypassQuietHours` is true for this category — a last call at 20:00 that
      // quiet hours swallowed would be a reminder that only ever fires for people
      // who did not need it.
      data: { category: 'streak', route: '/challenge' },
    });
  }

  // Only for a run with no buffer left. For everybody else tonight costs a
  // shield they will earn back, and a second evening notification about that is
  // how the whole category gets switched off.
  if (state.standing.shields > 0) return;
  const lastCallAt = fireAtHour(LAST_CALL_HOUR, now);
  if (lastCallAt === null) return;

  lastCallId = await scheduleOneTimeNotification({
    title: i18n.t('challenge.lastCallTitle'),
    body:
      cost !== null
        ? i18n.t('challenge.lastCallCost', { count: cost })
        : i18n.t('challenge.reminderOne', { modules }),
    date: lastCallAt,
    data: { category: 'streak', route: '/challenge' },
  });
}

/** Drops the pending reminders — on sign-out, or on leaving a run. */
export async function cancelChallengeReminder(): Promise<void> {
  await cancelNotification(scheduledId);
  await cancelNotification(lastCallId);
  scheduledId = null;
  lastCallId = null;
}

/**
 * The one nudge after a run breaks.
 *
 * A broken run is the highest-churn moment the programme has, and until now
 * nothing happened at it at all: the fall was settled overnight by
 * `settle_stale_runs`, and the next thing the user heard from the app was the
 * ordinary 20:00 reminder about a streak they no longer felt they had.
 *
 * Framed as the next rung rather than the lost one. "You lost 24 days" is
 * information they already have and can do nothing with; "24 days to Ember"
 * is the same arithmetic pointed forwards. Nobody needs to be told they missed.
 *
 * Forty-eight hours, not twenty-four. A day later is still inside the sting,
 * and the message reads as the app twisting the knife; two days later it reads
 * as an invitation. It is also long enough that anybody who simply carried on
 * has already qualified another day and cancelled it.
 *
 * ## What this cannot do
 *
 * It is a local notification, so it can only be scheduled while the app is
 * running — which means it reaches somebody who opened the app after the fall
 * and never somebody who has already stopped. That is not a limitation of where
 * it is called from; it is what local notifications are. Reaching a user who
 * has genuinely gone requires server push, which this deliberately is not.
 */
const WIN_BACK_DELAY_MS = 48 * 60 * 60 * 1000;

let winBackId: string | null = null;

export async function scheduleWinBack(toDays: number, nextRungDays: number | null): Promise<void> {
  await cancelNotification(winBackId);
  winBackId = null;

  if (!useChallengeStore.getState().enrolled) return;

  winBackId = await scheduleOneTimeNotification({
    title: i18n.t('challenge.winBackTitle'),
    body:
      nextRungDays !== null && nextRungDays > 0
        ? i18n.t('challenge.winBackNext', { count: nextRungDays })
        : i18n.t('challenge.winBackPlain', { count: toDays }),
    date: Date.now() + WIN_BACK_DELAY_MS,
    data: { category: 'streak', route: '/challenge' },
  });
}

/**
 * Drops a pending win-back.
 *
 * Called the moment a day completes, because somebody who has just kept a day
 * has answered the question the win-back exists to ask — and receiving it
 * anyway, two days after getting back on the horse, reads as the app not
 * paying attention.
 */
export async function cancelWinBack(): Promise<void> {
  await cancelNotification(winBackId);
  winBackId = null;
}
