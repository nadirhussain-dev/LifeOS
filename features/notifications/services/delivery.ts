import { syncDigest } from '@/features/notifications/services/digest';
import { useNotificationsStore } from '@/features/notifications/store/notifications-store';
import {
  CATEGORY_META,
  CATEGORY_ORDER,
  type NotificationCategory,
} from '@/features/notifications/types/notification.types';
import { cancelScheduledInCategory } from '@/lib/notifications';

/**
 * Categories that "smart digest" delivery folds into the morning summary
 * instead of firing on their own — every non-time-critical nudge. Time-critical
 * categories (bypassQuietHours: due tasks, calendar events, money, bedtime)
 * are excluded and always ping individually, as is the digest itself.
 */
export const CONSOLIDATED_CATEGORIES: NotificationCategory[] = CATEGORY_ORDER.filter(
  (category) => category !== 'digest' && !CATEGORY_META[category].bypassQuietHours,
);

/**
 * The mode this process last applied, or null before the first call.
 *
 * Only ever used to notice the digest → individual transition. A wrong answer
 * costs one redundant rebuild, never a missed one: the launch path resyncs
 * unconditionally straight after this, so a fresh process cannot end up in the
 * "reminders were cancelled and nothing rebuilt them" state this exists to
 * prevent.
 */
let lastAppliedMode: 'individual' | 'digest' | null = null;

/**
 * Brings scheduled notifications in line with the current delivery mode and
 * refreshes the morning digest. In digest mode it cancels any already-queued
 * nudge reminders so the day's low-signal reminders arrive only as the one
 * morning summary; the scheduling primitives then stop new ones from being
 * queued (see passesCategoryGate in lib/notifications). Idempotent — safe to
 * run on every launch and whenever the relevant settings change.
 *
 * ## Switching back now restores them
 *
 * It used not to. Turning digest mode on cancelled every nudge reminder, and
 * turning it off again could not bring them back — their text and timing live
 * on each item, so they only returned as each item happened to be saved. The
 * Settings screen said so, which made it documented rather than fixed: a user
 * trying the mode for an afternoon lost every hydration and habit reminder they
 * had until they went and re-saved each one by hand.
 *
 * `resyncAllReminders()` rebuilds all of them from the database, and now that
 * every module is reachable from it — the streak reminders were the last gap —
 * the transition is simply a rebuild. Awaited, so a caller that resyncs
 * afterwards joins this one rather than racing it.
 */
export async function applyDeliveryMode(): Promise<void> {
  const { deliveryMode } = useNotificationsStore.getState();
  const previous = lastAppliedMode;
  lastAppliedMode = deliveryMode;

  if (deliveryMode === 'digest') {
    await Promise.all(
      CONSOLIDATED_CATEGORIES.map((category) => cancelScheduledInCategory(category)),
    );
    await syncDigest();
    return;
  }

  await syncDigest();

  // Imported lazily to keep this module out of reminder-scheduler.ts's import
  // cycle — that file imports syncDigest from digest.ts, which this also uses.
  if (previous === 'digest') {
    const { resyncAllReminders } =
      await import('@/features/notifications/services/reminder-scheduler');
    await resyncAllReminders();
  }
}
