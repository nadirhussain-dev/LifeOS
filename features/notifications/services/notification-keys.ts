/**
 * Stable identities for scheduled notifications.
 *
 * Every key is spelled here rather than at the call site, for the same reason
 * every route constant is: a key that is typed by hand in two places is a key
 * that silently stops matching the moment one of them is edited, and a
 * cancel-by-key that matches nothing fails *quietly* — it schedules a duplicate
 * instead of throwing. See `NotificationPayload['key']` for what keys are for.
 *
 * A key names the reminder, not the notification. Two notifications with the
 * same key are the same reminder scheduled twice, and exactly one of them
 * should survive — which is what makes `challenge:at-risk` one key rather than
 * one per evening.
 */

/** The 20:00 last call, rebuilt on every write to the day's checklist. */
export const CHALLENGE_AT_RISK_KEY = 'challenge:at-risk';

/** The 22:00 second call, scheduled only for a run holding no shields. */
export const CHALLENGE_LAST_CALL_KEY = 'challenge:last-call';

/** The single nudge 48 hours after a run breaks. */
export const CHALLENGE_WIN_BACK_KEY = 'challenge:win-back';

/**
 * A rung paying out (0071), announced only when the app is not in front of the
 * user — the milestone sheet is what they get when it is.
 *
 * One key rather than one per rung, deliberately. Two payouts landing in the
 * same flush is a real case (a run restored by an operator settles arrears for
 * several rungs at once) and it is one event to the person receiving it; a key
 * per rung would put four notifications on their lock screen for one moment.
 */
export const CHALLENGE_REWARD_KEY = 'challenge:reward';

/* One reminder per row, keyed by the row it belongs to. Deleting the item is
 * what retires the key, and the launch rebuild only schedules keys for rows
 * that still exist — so an orphan cannot outlive its owner by more than one
 * launch. */

export const taskReminderKey = (taskId: string) => `task:${taskId}`;
export const noteReminderKey = (noteId: string) => `note:${noteId}`;
export const calendarEventReminderKey = (eventId: string) => `calendar:${eventId}`;
export const debtReminderKey = (debtId: string) => `debt:${debtId}`;
export const goalReminderKey = (goalId: string) => `goal:${goalId}`;

/* Sets, not single reminders — see `cancelScheduledByKeyPrefix`. Each member
 * needs a key of its own or rebuilding the set would cancel its own siblings,
 * and each set needs a prefix or a member the new set drops would have a key
 * nothing ever mentions again. */

export const GOAL_KEY_PREFIX = 'goal:';

export const WATER_KEY_PREFIX = 'water:';
export const waterReminderKey = (hour: number, minute: number) =>
  `${WATER_KEY_PREFIX}${String(hour).padStart(2, '0')}${String(minute).padStart(2, '0')}`;

export const STUDY_KEY_PREFIX = 'study:';
export const studyReminderKey = (weekday: number) => `${STUDY_KEY_PREFIX}d${weekday}`;

/** Per habit, so rebuilding one habit's reminders leaves every other habit's
 *  alone. `daily` is its own member: a habit scheduled every day is one daily
 *  trigger rather than seven weekly ones. */
export const habitKeyPrefix = (habitId: string) => `habit:${habitId}:`;
export const habitReminderKey = (habitId: string, weekday: number | 'daily') =>
  `${habitKeyPrefix(habitId)}${weekday === 'daily' ? 'daily' : `d${weekday}`}`;

/* Singletons — one per install, so the key is a constant. */

export const JOURNAL_REMINDER_KEY = 'journal:daily';
export const SLEEP_REMINDER_KEY = 'sleep:bedtime';
export const REVIEW_REMINDER_KEY = 'review:weekly';
export const DIGEST_REMINDER_KEY = 'digest:daily';
export const CYCLE_REMINDER_KEY = 'cycle:expected';

/** Together's nearest-milestone nudge — one at a time, whichever milestone is
 *  soonest, so it is a singleton like the others. */
export const TOGETHER_REMINDER_KEY = 'together:milestone';
