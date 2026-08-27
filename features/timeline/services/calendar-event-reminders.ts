import { format } from 'date-fns/format';

import { setCalendarEventReminderNotificationId } from '@/features/timeline/services/calendar-events-repository';
import i18n from '@/lib/i18n';
import { calendarEventReminderKey } from '@/features/notifications/services/notification-keys';
import { cancelNotification, scheduleOneTimeNotification } from '@/lib/notifications';
import type { CalendarEvent } from '@/features/timeline/types/timeline.types';

export async function scheduleCalendarEventReminder(event: CalendarEvent): Promise<void> {
  // Cancel first — every other module's sync does, and without it a resync (or
  // a second call for the same event) leaves the previous notification queued
  // alongside the new one.
  await cancelNotification(event.reminderNotificationId);
  if (event.reminderMinutesBefore == null) {
    setCalendarEventReminderNotificationId(event.id, null);
    return;
  }

  const triggerAt = event.startAt - event.reminderMinutesBefore * 60_000;
  const id = await scheduleOneTimeNotification({
    title: event.title,
    body:
      event.reminderMinutesBefore === 0
        ? i18n.t('timeline.reminderStartingNow')
        : i18n.t('timeline.reminderStartingIn', { count: event.reminderMinutesBefore }),
    date: triggerAt,
    data: {
      category: 'calendar',
      route: '/timeline/[date]',
      params: { date: format(event.startAt, 'yyyy-MM-dd') },
      key: calendarEventReminderKey(event.id),
    },
  });
  setCalendarEventReminderNotificationId(event.id, id);
}

export async function cancelCalendarEventReminder(
  event: Pick<CalendarEvent, 'id' | 'reminderNotificationId'>,
): Promise<void> {
  await cancelNotification(event.reminderNotificationId);
  // Clearing the column is what every other module's cancel does, and skipping
  // it left the row pointing at an id the OS no longer knows — so a later sync
  // would "cancel" a stranger's notification id and the event looked like it
  // still had a reminder queued.
  setCalendarEventReminderNotificationId(event.id, null);
}
