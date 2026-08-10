import {
  useStudyReminderStore,
  type StudyReminderSettings,
} from '@/features/study/store/study-reminder-store';
import i18n from '@/lib/i18n';
import { cancelNotifications, scheduleWeeklyNotification } from '@/lib/notifications';

/**
 * The daily study nudge.
 *
 * Like `goals`, the `study` notification category existed with no scheduler
 * behind it, so its switch was hidden from Settings. This is what earns it back.
 *
 * ## Weekly triggers, not a daily one
 *
 * One weekly notification per selected weekday. Scheduling a DAILY trigger and
 * hoping the user ignores it on their days off is the bug that was found and
 * fixed in habit reminders (see `scheduleWeeklyNotification`) — it nags on the
 * days it was explicitly told not to, which is how a category gets switched off
 * entirely.
 *
 * ## It cannot know whether you already studied
 *
 * A local notification carries fixed text decided at scheduling time and cannot
 * evaluate anything when it fires, so this will occasionally arrive on an
 * evening you have already done two hours. The alternative is server push, which
 * is the same reason streak-at-risk reminders are still deferred. The copy is
 * therefore an invitation rather than an accusation — "ready for a session?"
 * survives arriving at a bad moment in a way that "you haven't studied today"
 * does not.
 */
export async function syncStudyReminders(
  settings: StudyReminderSettings = useStudyReminderStore.getState().settings,
): Promise<string[]> {
  const store = useStudyReminderStore.getState();
  await cancelNotifications(store.scheduledNotificationIds);

  if (!settings.enabled || settings.days.length === 0) {
    store.setReminder(settings, []);
    return [];
  }

  const ids: string[] = [];
  // Deduped: a repeated weekday in the stored array would otherwise schedule two
  // identical notifications for the same evening.
  for (const weekday of [...new Set(settings.days)]) {
    const id = await scheduleWeeklyNotification({
      title: i18n.t('study.reminderNotifTitle'),
      body: i18n.t('study.reminderNotifBody'),
      weekday,
      hour: settings.hour,
      minute: settings.minute,
      data: { category: 'study', route: '/study' },
    });
    if (id) ids.push(id);
  }

  store.setReminder(settings, ids);
  return ids;
}
