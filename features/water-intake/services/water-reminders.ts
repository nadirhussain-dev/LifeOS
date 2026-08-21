import {
  WATER_KEY_PREFIX,
  waterReminderKey,
} from '@/features/notifications/services/notification-keys';
import { allowance } from '@/features/notifications/services/scheduling-budget';
import i18n from '@/lib/i18n';
import {
  cancelNotifications,
  cancelScheduledByKeyPrefix,
  scheduleDailyNotification,
  SCHEDULING_BUDGET,
} from '@/lib/notifications';
import { spreadAcross, timeSlots } from '@/features/water-intake/services/water-schedule';
import type { WaterReminderSettings } from '@/features/water-intake/types/water-intake.types';

export async function cancelWaterReminders(notificationIds: string[]): Promise<void> {
  await cancelNotifications(notificationIds);
}

/** Schedules one DAILY-repeating local notification per interval slot within
 * the reminder window (e.g. every hour from 8am–9pm = 14 notifications) —
 * expo-notifications has no native "repeat every N minutes within a daily
 * window" trigger, so this composes it from plain daily-at-HH:mm triggers. */
export async function scheduleWaterReminders(settings: WaterReminderSettings): Promise<string[]> {
  // The set shrinks as well as grows — widening the interval from hourly to
  // every three hours retires ten slots — and a slot that is gone has a key
  // nothing will schedule again. Clearing the prefix first makes the rebuild
  // wholesale, which is what this function has always meant to be.
  await cancelScheduledByKeyPrefix(WATER_KEY_PREFIX);

  if (!settings.enabled) return [];

  /**
   * Hydration takes what is left, not what it asked for.
   *
   * It is simultaneously the biggest consumer of the pending-notification queue
   * and the least consequential thing in it, so it is the right feature to
   * absorb the platform ceiling. `timeSlots` already caps its own appetite; this
   * is the second bound, against everything else the app has already scheduled
   * this rebuild — a phone with many tasks and habits leaves less room, and
   * hydration yields rather than pushing a due-time out of the queue.
   *
   * DIGEST_RESERVE keeps a few slots for the steps that run after this one (the
   * morning digest, and the private-space reminders registered via
   * `registerReminderStep`), which would otherwise find the budget spent.
   */
  const DIGEST_RESERVE = 4;
  const slots = timeSlots(settings);
  const chosen = spreadAcross(slots, allowance(slots.length, SCHEDULING_BUDGET, DIGEST_RESERVE));
  if (chosen.length === 0) return [];

  const ids = await Promise.all(
    chosen.map((slot) =>
      scheduleDailyNotification({
        title: i18n.t('water.reminderNotifTitle'),
        body: i18n.t('water.reminderNotifBody'),
        hour: slot.hour,
        minute: slot.minute,
        data: {
          category: 'water',
          route: '/water-intake/history',
          key: waterReminderKey(slot.hour, slot.minute),
        },
      }),
    ),
  );
  return ids.filter((id): id is string => id !== null);
}
