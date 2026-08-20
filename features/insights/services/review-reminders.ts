import { REVIEW_REMINDER_KEY } from '@/features/notifications/services/notification-keys';
import { cancelNotifications, scheduleWeeklyNotification } from '@/lib/notifications';
import i18n from '@/lib/i18n';
import {
  useReviewReminderStore,
  type ReviewReminderSettings,
} from '@/features/insights/store/review-reminder-store';

/**
 * Schedules the one weekly review notification, replacing any existing one.
 *
 * A single weekly trigger rather than a daily one that checks the weekday: a
 * DAILY trigger nags on the six days it was told not to, which is the same
 * mistake the study reminders document.
 */
export async function syncReviewReminder(
  settings: ReviewReminderSettings = useReviewReminderStore.getState().settings,
): Promise<string | null> {
  const store = useReviewReminderStore.getState();
  if (store.scheduledNotificationId) {
    await cancelNotifications([store.scheduledNotificationId]);
  }

  if (!settings.enabled) {
    store.setReminder(settings, null);
    return null;
  }

  const id = await scheduleWeeklyNotification({
    title: i18n.t('insights.reviewNotifTitle'),
    body: i18n.t('insights.reviewNotifBody'),
    weekday: settings.weekday,
    hour: settings.hour,
    minute: settings.minute,
    data: { category: 'review', route: '/review', key: REVIEW_REMINDER_KEY },
  });

  store.setReminder(settings, id ?? null);
  return id ?? null;
}
