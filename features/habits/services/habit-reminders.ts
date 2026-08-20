import { setHabitReminderNotificationId } from '@/features/habits/services/habits-repository';
import {
  habitKeyPrefix,
  habitReminderKey,
} from '@/features/notifications/services/notification-keys';
import i18n from '@/lib/i18n';
import {
  cancelPackedNotifications,
  cancelScheduledByKeyPrefix,
  packNotificationIds,
  scheduleDailyNotification,
  scheduleWeeklyNotification,
} from '@/lib/notifications';
import { reminderWeekdays } from '@/features/habits/services/habit-schedule';
import type { Habit } from '@/features/habits/types/habit.types';

function parseReminderTime(reminderTime: string): { hour: number; minute: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(reminderTime.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

/** Cancels any previously-scheduled reminders and, if the habit still wants
 * one, schedules fresh notifications at reminder_time — one per scheduled
 * weekday, or a single daily trigger when the habit runs every day. Called
 * after every create/update so the schedule can never drift from what's saved. */
export async function syncHabitReminder(habit: Habit): Promise<void> {
  await cancelPackedNotifications(habit.reminderNotificationId);
  // By prefix as well as by stored id, because the set changes shape: a habit
  // moved from Mon/Wed/Fri to Mon/Tue leaves a Friday trigger whose key nothing
  // will mention again, and one moved to "every day" leaves all three. The
  // stored ids cover the same ground only while the app has never lost track of
  // them — this is the half that self-heals.
  await cancelScheduledByKeyPrefix(habitKeyPrefix(habit.id));

  const parsed = habit.reminderTime ? parseReminderTime(habit.reminderTime) : null;
  if (!parsed) {
    setHabitReminderNotificationId(habit.id, null);
    return;
  }

  const content = {
    title: `${habit.emoji ?? '💪'} ${habit.name}`,
    body: i18n.t('habits.reminderBody'),
  };
  const payload = (weekday: number | 'daily') =>
    ({
      category: 'habits',
      route: '/habits',
      key: habitReminderKey(habit.id, weekday),
    }) as const;

  const weekdays = reminderWeekdays(habit);

  const ids =
    weekdays === null
      ? [await scheduleDailyNotification({ ...content, ...parsed, data: payload('daily') })]
      : await Promise.all(
          weekdays.map((weekday) =>
            scheduleWeeklyNotification({
              ...content,
              weekday,
              ...parsed,
              data: payload(weekday),
            }),
          ),
        );

  setHabitReminderNotificationId(habit.id, packNotificationIds(ids));
}

export async function cancelHabitReminder(
  habit: Pick<Habit, 'id' | 'reminderNotificationId'>,
): Promise<void> {
  await cancelPackedNotifications(habit.reminderNotificationId);
  await cancelScheduledByKeyPrefix(habitKeyPrefix(habit.id));
  setHabitReminderNotificationId(habit.id, null);
}
