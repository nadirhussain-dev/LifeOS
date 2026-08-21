import {
  getSleepReminderNotificationId,
  getSleepSettings,
  setSleepReminderNotificationId,
} from '@/features/sleep/services/sleep-repository';
import { formatClock } from '@/features/sleep/services/sleep-stats';
import i18n from '@/lib/i18n';
import { SLEEP_REMINDER_KEY } from '@/features/notifications/services/notification-keys';
import { cancelNotification, scheduleDailyNotification } from '@/lib/notifications';

function parseHHmm(value: string): { hour: number; minute: number } | null {
  if (!/^\d{1,2}:\d{2}$/.test(value)) return null;
  const [hour, minute] = value.split(':').map(Number);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

/** Cancels the old bedtime reminder and, if enabled with a target bedtime,
 * schedules a fresh daily notification at that time. Called after every
 * settings save so the schedule never drifts from what's stored. */
export async function syncBedtimeReminder(): Promise<void> {
  await cancelNotification(getSleepReminderNotificationId());

  const settings = getSleepSettings();
  const time = settings.targetBedtime ? parseHHmm(settings.targetBedtime) : null;
  if (!settings.reminderEnabled || !time) {
    setSleepReminderNotificationId(null);
    return;
  }

  const id = await scheduleDailyNotification({
    title: i18n.t('sleep.reminderNotifTitle'),
    body: i18n.t('sleep.reminderNotifBody', {
      time: formatClock(time.hour * 60 + time.minute),
    }),
    hour: time.hour,
    minute: time.minute,
    data: { category: 'sleep', route: '/sleep', key: SLEEP_REMINDER_KEY },
  });
  setSleepReminderNotificationId(id);
}
