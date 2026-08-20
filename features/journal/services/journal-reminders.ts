import i18n from '@/lib/i18n';
import { JOURNAL_REMINDER_KEY } from '@/features/notifications/services/notification-keys';
import { cancelNotification, scheduleDailyNotification } from '@/lib/notifications';
import type { JournalReminderSettings } from '@/features/journal/store/journal-reminder-store';

export async function cancelJournalReminder(notificationId: string | null): Promise<void> {
  await cancelNotification(notificationId);
}

/** Schedules a single DAILY-repeating "write today's entry" nudge. */
export async function scheduleJournalReminder(
  settings: JournalReminderSettings,
): Promise<string | null> {
  if (!settings.enabled) return null;

  return scheduleDailyNotification({
    title: i18n.t('journal.reminderNotifTitle'),
    body: i18n.t('journal.reminderNotifBody'),
    hour: settings.hour,
    minute: settings.minute,
    data: { category: 'journal', route: '/journal', key: JOURNAL_REMINDER_KEY },
  });
}
