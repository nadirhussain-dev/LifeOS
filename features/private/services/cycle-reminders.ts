import { addDays, parseISO, set } from 'date-fns';

import { listCycleEntries } from '@/features/private/services/cycle';
import { averageCycleLength, periodsFrom, predictedNextStart } from '@/features/private/services/cycle-math';
import { useCycleSettingsStore } from '@/features/private/store/cycle-settings-store';
import i18n from '@/lib/i18n';
import { cancelNotification, scheduleOneTimeNotification } from '@/lib/notifications';

/** Fires this many days before the predicted start — enough notice to be
 *  useful, not so far out that a shifted cycle makes it stale before it
 *  fires. Matches the general shape of goal-reminders.ts's lead time, scaled
 *  down for a window this narrow. */
const REMINDER_DAYS_BEFORE = 2;
/** Local hour the reminder fires at, absent any per-feature time setting to
 *  read (unlike goals/water, cycle has no reminder-time preference UI). */
const REMINDER_HOUR = 9;

/**
 * Rebuilds the single "period expected soon" reminder from this device's own
 * logged history.
 *
 * Unlike every other step in reminder-scheduler.ts, this cannot rely on that
 * scheduler's `cancelAllScheduled()` sweep alone: `listCycleEntries()`
 * silently returns nothing while the vault is locked (private-repository.ts),
 * and `resyncAllReminders()` runs at cold launch — before a PIN has been
 * entered. A launch-only call to this function would therefore recompute
 * "no periods" forever and never actually see the data. So this is ALSO
 * called reactively, straight from `usePrivateStore`'s `unlock()` and from
 * `addCycleEntry`/`editCycleEntry`/`removeCycleEntry` (cycle.ts) — call sites
 * that never went through `cancelAllScheduled()`, which is why this cancels
 * its own previously-queued id first rather than assuming a clean slate.
 *
 * Deliberately generic in body text, same reasoning as together-reminders.ts:
 * this is the single most sensitive category in the app, and there is
 * nothing here worth the risk of a lock-screen leak.
 */
export async function syncCycleReminders(): Promise<void> {
  const store = useCycleSettingsStore.getState();
  await cancelNotification(store.reminderNotificationId);

  const entries = listCycleEntries();
  const periods = periodsFrom(entries);
  const average = averageCycleLength(periods);
  const nextStart = predictedNextStart(periods, average);
  if (!nextStart) {
    store.setReminderNotificationId(null);
    return;
  }

  const fireAt = set(addDays(parseISO(nextStart), -REMINDER_DAYS_BEFORE), {
    hours: REMINDER_HOUR,
    minutes: 0,
    seconds: 0,
    milliseconds: 0,
  });
  if (fireAt.getTime() <= Date.now()) {
    store.setReminderNotificationId(null);
    return;
  }

  // Reuses the app's own redaction copy (notification-visibility.ts)
  // unconditionally — see this function's header on why this, the single
  // most sensitive category in the app, gets that treatment regardless of
  // whether the user separately privatised it.
  const id = await scheduleOneTimeNotification({
    title: i18n.t('notif.redactedTitle'),
    body: i18n.t('notif.redactedBody'),
    date: fireAt.getTime(),
    data: { category: 'cycle', route: '/private/cycle' },
  });
  store.setReminderNotificationId(id);
}
