import { and, desc, eq, isNotNull, isNull, lte, ne, sql } from 'drizzle-orm';

import { getDb } from '@/database/client';
import { notificationLog } from '@/database/schema';
import { firedWhileAway } from '@/features/notifications/services/missed-occurrences';
import { generateId } from '@/lib/id';
import { LOCAL_USER_ID } from '@/lib/local-user';
import type {
  LoggedNotification,
  NotificationCategory,
  NotificationRepeat,
} from '@/features/notifications/types/notification.types';

export type LogNotificationInput = {
  /** Caller may supply the row id so it can be embedded in the notification's
   * payload before scheduling (enables tap→mark-this-row-read). Auto-generated
   * when omitted. */
  id?: string;
  notificationId: string | null;
  category: NotificationCategory;
  title: string;
  body: string;
  route?: string;
  params?: Record<string, string>;
  scheduledAt: number;
  repeats: NotificationRepeat;
};

type Row = typeof notificationLog.$inferSelect;

function toLogged(row: Row): LoggedNotification {
  return {
    id: row.id,
    notificationId: row.notificationId,
    category: row.category as NotificationCategory,
    title: row.title,
    body: row.body,
    route: row.route,
    params: row.params ? (JSON.parse(row.params) as Record<string, string>) : null,
    scheduledAt: row.scheduledAt,
    repeats: row.repeats as NotificationRepeat,
    deliveredAt: row.deliveredAt,
    readAt: row.readAt,
    canceledAt: row.canceledAt,
    createdAt: row.createdAt,
  };
}

/** Records a scheduled notification in the inbox log. Returns the new row id
 * (also written into the notification's data payload for tap→mark-read). */
export function logScheduledNotification(input: LogNotificationInput): string {
  const now = Date.now();
  const id = input.id ?? generateId();
  getDb()
    .insert(notificationLog)
    .values({
      id,
      userId: LOCAL_USER_ID,
      notificationId: input.notificationId,
      category: input.category,
      title: input.title,
      body: input.body,
      route: input.route ?? null,
      params: input.params ? JSON.stringify(input.params) : null,
      scheduledAt: input.scheduledAt,
      repeats: input.repeats,
      readAt: null,
      canceledAt: null,
      createdAt: now,
    })
    .run();
  return id;
}

/** Removes the log row(s) for a cancelled notification id. Called from the
 * cancel path so the inbox never shows reminders that are no longer queued. */
export function deleteLogByNotificationId(notificationId: string | null | undefined): void {
  if (!notificationId) return;
  getDb().delete(notificationLog).where(eq(notificationLog.notificationId, notificationId)).run();
}

/** Inbox contents, newest scheduled/delivered first. Excludes cancelled rows. */
export function listNotificationLog(limit = 100): LoggedNotification[] {
  const rows = getDb()
    .select()
    .from(notificationLog)
    .where(and(eq(notificationLog.userId, LOCAL_USER_ID), isNull(notificationLog.canceledAt)))
    .orderBy(desc(notificationLog.scheduledAt))
    .limit(limit)
    .all();
  return rows.map(toLogged);
}

/**
 * Records that a notification actually arrived.
 *
 * The inbox used to be a log of what had been *scheduled*, with delivery
 * inferred from the clock. That silently excluded almost everything:
 *
 *  - a repeating reminder's `scheduledAt` is always its NEXT fire, so it never
 *    read as past, and the badge deliberately filtered `repeats = 'none'` to
 *    avoid a count that could never clear. Every habit, hydration, journal,
 *    bedtime and digest notification was therefore invisible in-app.
 *  - a push (a shared-group update) is never scheduled on this device at all,
 *    so it had no row to infer anything from.
 *
 * Now arrivals are written down. A one-time reminder's own row is marked; a
 * repeating one gets a NEW row per delivery so its schedule row keeps pointing
 * at the next occurrence; anything unrecognised (i.e. a push) is inserted.
 */
export function recordNotificationDelivery(input: {
  /** Present when this app scheduled it and stamped the payload. */
  logId?: string | null;
  notificationId?: string | null;
  category: NotificationCategory;
  title: string;
  body: string;
  route?: string | null;
  params?: Record<string, string> | null;
  deliveredAt?: number;
}): string {
  const db = getDb();
  const deliveredAt = input.deliveredAt ?? Date.now();

  if (input.logId) {
    const existing = db
      .select()
      .from(notificationLog)
      .where(eq(notificationLog.id, input.logId))
      .get();

    if (existing) {
      if (existing.repeats === 'none') {
        db.update(notificationLog)
          .set({ deliveredAt })
          .where(eq(notificationLog.id, input.logId))
          .run();
        return input.logId;
      }
      // Repeating: leave the schedule row alone and record this occurrence.
      return insertDelivered({ ...input, deliveredAt, repeats: 'none' });
    }
  }

  return insertDelivered({ ...input, deliveredAt, repeats: 'none' });
}

function insertDelivered(input: {
  notificationId?: string | null;
  category: NotificationCategory;
  title: string;
  body: string;
  route?: string | null;
  params?: Record<string, string> | null;
  deliveredAt: number;
  repeats: NotificationRepeat;
}): string {
  const id = generateId();
  getDb()
    .insert(notificationLog)
    .values({
      id,
      userId: LOCAL_USER_ID,
      notificationId: input.notificationId ?? null,
      category: input.category,
      title: input.title,
      body: input.body,
      route: input.route ?? null,
      params: input.params ? JSON.stringify(input.params) : null,
      scheduledAt: input.deliveredAt,
      repeats: input.repeats,
      deliveredAt: input.deliveredAt,
      createdAt: input.deliveredAt,
    })
    .run();
  return id;
}

/**
 * Stamps one-time reminders whose moment has passed as delivered.
 *
 * `recordNotificationDelivery` is driven by expo's arrival listener, which only
 * runs while the app is alive. A reminder that fires with the app killed — the
 * normal case for a morning nudge — is shown by the OS, and JS never hears
 * about it. The row keeps `deliveredAt = null` forever, so the bell badge
 * (which requires a recorded arrival) could never count it: the inbox listed
 * the notification as delivered, via `notificationStatus`'s clock fallback,
 * while the badge insisted there was nothing unread. Two views of one table
 * disagreeing.
 *
 * This closes that by writing down what `notificationStatus` already infers:
 * past + one-time + not cancelled + never stamped ⇒ it fired. `deliveredAt` is
 * set to `scheduledAt`, not `now`, so the inbox timestamp reads when it
 * actually arrived rather than when the app happened to reopen.
 *
 * Deliberately limited to `repeats = 'none'`. A repeating row's `scheduledAt`
 * points at its NEXT occurrence, so it is never "past" and there is no record
 * of how many times it fired while the app was closed — stamping it would both
 * lie and consume the schedule row. Those still only register when the app is
 * running to hear them; catching them needs a background task, which is a
 * native change to validate on a device.
 *
 * Returns the number of rows stamped so callers can skip a cache invalidation
 * when nothing changed. Idempotent — a stamped row no longer matches.
 */
export function reconcilePassedNotifications(now = Date.now()): number {
  const result = getDb()
    .update(notificationLog)
    .set({ deliveredAt: sql`${notificationLog.scheduledAt}` })
    .where(
      and(
        eq(notificationLog.userId, LOCAL_USER_ID),
        isNull(notificationLog.canceledAt),
        isNull(notificationLog.deliveredAt),
        eq(notificationLog.repeats, 'none'),
        lte(notificationLog.scheduledAt, now),
      ),
    )
    .run();
  return result.changes ?? 0;
}

/**
 * Records repeating reminders that fired while the app was closed.
 *
 * The companion to `reconcilePassedNotifications`, which handles one-time rows
 * and deliberately skips repeating ones. A daily habit reminder firing every
 * morning for a week left no trace in the inbox: the arrival listener needs a
 * live process, and the schedule row's `scheduledAt` points at the next fire,
 * so nothing ever read as past. See missed-occurrences.ts for the arithmetic
 * that recovers when the last one was.
 *
 * One row per schedule, not one per occurrence. A week away is "this reminder
 * fired while you were gone", not seven identical entries — the schedule row
 * itself survives untouched, still pointing at the next fire.
 *
 * `cap` bounds a long absence: someone returning after a month with fifteen
 * schedules should not find the inbox rebuilt around notifications they have
 * already seen and dismissed on the lock screen.
 *
 * MUST run before the resync's `cancelAllScheduled()`, which deletes exactly
 * the scheduled rows this reads.
 */
export function recordMissedRepeatingDeliveries(since: number, now = Date.now(), cap = 20): number {
  const db = getDb();
  const rows = db
    .select()
    .from(notificationLog)
    .where(
      and(
        eq(notificationLog.userId, LOCAL_USER_ID),
        isNull(notificationLog.canceledAt),
        isNull(notificationLog.deliveredAt),
        ne(notificationLog.repeats, 'none'),
      ),
    )
    .all();

  let recorded = 0;
  for (const row of rows) {
    if (recorded >= cap) break;
    const occurrence = firedWhileAway(
      row.scheduledAt,
      row.repeats as NotificationRepeat,
      since,
      now,
    );
    if (occurrence === null) continue;

    insertDelivered({
      notificationId: row.notificationId,
      category: row.category as NotificationCategory,
      title: row.title,
      body: row.body,
      route: row.route,
      params: row.params ? (JSON.parse(row.params) as Record<string, string>) : null,
      deliveredAt: occurrence,
      repeats: 'none',
    });
    recorded += 1;
  }
  return recorded;
}

/**
 * Badge count: notifications that have arrived and not been read.
 *
 * Keyed on recorded delivery rather than on the clock, so repeating reminders
 * and pushes finally count — and, because each delivery is its own row, the
 * count still clears when they are read.
 */
export function unreadNotificationCount(_now = Date.now()): number {
  const result = getDb()
    .select({ count: sql<number>`count(*)` })
    .from(notificationLog)
    .where(
      and(
        eq(notificationLog.userId, LOCAL_USER_ID),
        isNull(notificationLog.canceledAt),
        isNull(notificationLog.readAt),
        isNotNull(notificationLog.deliveredAt),
      ),
    )
    .get();
  return result?.count ?? 0;
}

export function markNotificationRead(logId: string): void {
  getDb()
    .update(notificationLog)
    .set({ readAt: Date.now() })
    .where(eq(notificationLog.id, logId))
    .run();
}

export function markAllNotificationsRead(): void {
  getDb()
    .update(notificationLog)
    .set({ readAt: Date.now() })
    .where(and(eq(notificationLog.userId, LOCAL_USER_ID), isNull(notificationLog.readAt)))
    .run();
}

/** Hard-deletes a single inbox row (user swipe/clear). */
export function deleteNotificationLog(logId: string): void {
  getDb().delete(notificationLog).where(eq(notificationLog.id, logId)).run();
}

export function clearNotificationLog(): void {
  getDb().delete(notificationLog).where(eq(notificationLog.userId, LOCAL_USER_ID)).run();
}
