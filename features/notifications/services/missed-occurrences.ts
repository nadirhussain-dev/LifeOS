import type { NotificationRepeat } from '@/features/notifications/types/notification.types';

/**
 * When a repeating reminder last fired.
 *
 * ## The gap this closes
 *
 * `reconcilePassedNotifications` catches one-time reminders that fired with the
 * app closed, by stamping rows whose moment has passed. It deliberately skips
 * repeating ones, because a repeating row's `scheduledAt` is its NEXT
 * occurrence — never "past", and stamping it would consume the schedule row as
 * if it were an arrival.
 *
 * So a daily habit reminder that fired every morning for a week while the app
 * sat closed left no trace in the inbox at all. The OS showed all seven; the
 * app knew about none of them.
 *
 * The occurrence is recoverable rather than lost: the row records the cadence
 * and the next fire, and stepping backwards from there says exactly when the
 * last one was. That is what this computes, without touching the schedule row.
 *
 * ## Fixed periods, and where that is wrong
 *
 * A day is 24h and a week is 7×24h here. Across a DST boundary the real gap is
 * 23 or 25 hours, so an occurrence computed through one can be off by an hour.
 * That is an hour of error on a timestamp shown as "5 hours ago" in a list — it
 * does not change which day it lands on, and it costs nothing to be wrong
 * about. The alternative is calendar arithmetic over an unbounded number of
 * steps, which is a great deal of machinery for a relative timestamp.
 */

const DAY = 24 * 60 * 60 * 1000;
const WEEK = 7 * DAY;

export function periodFor(repeats: NotificationRepeat): number | null {
  if (repeats === 'daily') return DAY;
  if (repeats === 'weekly') return WEEK;
  return null;
}

/**
 * The most recent moment this schedule fired at or before `now`, or null if it
 * does not repeat — or has not fired yet.
 *
 * `scheduledAt` is normally the next occurrence, but it goes stale: it is
 * written when the reminder is scheduled and only refreshed by a resync, so
 * after a few days closed it sits in the past. Both directions are handled by
 * stepping to the last multiple of the period that has not passed `now`.
 */
export function mostRecentOccurrence(
  scheduledAt: number,
  repeats: NotificationRepeat,
  now: number,
): number | null {
  const period = periodFor(repeats);
  if (period === null) return null;

  const elapsed = now - scheduledAt;
  const occurrence =
    elapsed >= 0
      ? // Stale row: walk forward to the last occurrence that has happened.
        scheduledAt + Math.floor(elapsed / period) * period
      : // Fresh row pointing at the next fire: the previous one is a period back.
        scheduledAt - period;

  // A reminder scheduled for tomorrow that has never fired has no past
  // occurrence to report — only one it will have.
  return occurrence <= now && occurrence > 0 ? occurrence : null;
}

/**
 * Whether this schedule fired while nobody was watching.
 *
 * `since` is when the app last accounted for arrivals. An occurrence at or
 * before it has already been recorded (or predates the app caring), so only a
 * strictly later one counts as missed.
 */
export function firedWhileAway(
  scheduledAt: number,
  repeats: NotificationRepeat,
  since: number,
  now: number,
): number | null {
  const occurrence = mostRecentOccurrence(scheduledAt, repeats, now);
  if (occurrence === null) return null;
  return occurrence > since ? occurrence : null;
}
