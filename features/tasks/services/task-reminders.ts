import { set } from 'date-fns/set';
import { startOfDay } from 'date-fns/startOfDay';

import { setTaskReminderNotificationId } from '@/features/tasks/services/tasks-repository';
import i18n from '@/lib/i18n';
import { taskReminderKey } from '@/features/notifications/services/notification-keys';
import { cancelNotification, scheduleOneTimeNotification } from '@/lib/notifications';
import type { Task } from '@/features/tasks/types/task.types';

/** All-day tasks (no specific due time) remind at 9am on the due date —
 * the same default other calendar apps use for date-only reminders. */
const ALL_DAY_REMINDER_HOUR = 9;

/** Cancels any previously-scheduled reminder and, if the task still wants
 * one and has an incomplete, future due date, schedules a fresh one-time
 * notification for it — called after every create/update/complete so the
 * schedule can never drift from what's saved. */
export async function syncTaskReminder(task: Task): Promise<void> {
  await cancelNotification(task.reminderNotificationId);

  if (
    !task.reminderEnabled ||
    !task.dueDate ||
    task.status === 'completed' ||
    task.status === 'archived'
  ) {
    setTaskReminderNotificationId(task.id, null);
    return;
  }

  const triggerAt = task.hasDueTime
    ? task.dueDate
    : set(startOfDay(task.dueDate), { hours: ALL_DAY_REMINDER_HOUR }).getTime();

  const id = await scheduleOneTimeNotification({
    title: task.title,
    body: i18n.t(task.hasDueTime ? 'tasks.reminderDueNow' : 'tasks.reminderDueToday'),
    date: triggerAt,
    data: { category: 'tasks', route: '/tasks', key: taskReminderKey(task.id) },
  });
  setTaskReminderNotificationId(task.id, id);
}

export async function cancelTaskReminder(
  task: Pick<Task, 'id' | 'reminderNotificationId'>,
): Promise<void> {
  await cancelNotification(task.reminderNotificationId);
  setTaskReminderNotificationId(task.id, null);
}
