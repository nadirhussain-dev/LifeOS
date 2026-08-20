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
