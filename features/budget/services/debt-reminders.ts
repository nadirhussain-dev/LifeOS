import { setHours } from 'date-fns/setHours';
import { setMinutes } from 'date-fns/setMinutes';
import { setSeconds } from 'date-fns/setSeconds';
import { startOfDay } from 'date-fns/startOfDay';
import { subDays } from 'date-fns/subDays';

import { formatDate } from '@/lib/date-format';
import { setDebtReminderNotificationId } from '@/features/budget/services/debts-repository';
import { formatMoney } from '@/features/budget/services/money';
import i18n from '@/lib/i18n';
import { debtReminderKey } from '@/features/notifications/services/notification-keys';
import { cancelNotification, scheduleOneTimeNotification } from '@/lib/notifications';
import type { Debt } from '@/features/budget/types/budget.types';

/** Fixed hour the reminder fires on its scheduled day. */
const REMINDER_HOUR = 9;

/** The moment a debt's reminder should fire: `reminderDaysBefore` days before
 * the deadline, at 09:00 local. Returns null when it can't/shouldn't fire. */
export function debtReminderDate(
  debt: Pick<Debt, 'dueDate' | 'reminderDaysBefore'>,
): number | null {
  if (debt.dueDate == null || debt.reminderDaysBefore == null) return null;
  const day = subDays(startOfDay(new Date(debt.dueDate)), debt.reminderDaysBefore);
  return setSeconds(setMinutes(setHours(day, REMINDER_HOUR), 0), 0).getTime();
}

/** Cancels any previously-scheduled reminder and, if the debt is still active
 * and wants one, schedules a fresh notification. Called after every
 * create/update/payment so the schedule never drifts from what's saved. */
export async function syncDebtReminder(debt: Debt): Promise<void> {
  await cancelNotification(debt.reminderNotificationId);

  const remaining = Math.max(0, debt.principalCents - debt.paidCents);
  const fireAt = debtReminderDate(debt);
  if (debt.settledAt != null || remaining === 0 || fireAt == null) {
    setDebtReminderNotificationId(debt.id, null);
    return;
  }

  const amount = formatMoney(remaining, debt.currency);
  const dueLabel = debt.dueDate ? formatDate(debt.dueDate, 'dayMonth') : '';
  const borrowed = debt.direction === 'borrowed';
  const title = i18n.t(borrowed ? 'budget.debtReminderOweTitle' : 'budget.debtReminderOwedTitle', {
    name: debt.counterparty,
  });
  const body = i18n.t(borrowed ? 'budget.debtReminderOweBody' : 'budget.debtReminderOwedBody', {
    amount,
    date: dueLabel,
  });

  const id = await scheduleOneTimeNotification({
    title,
    body: body.trim(),
    date: fireAt,
    data: {
      category: 'budget',
      route: '/budget/debts/[id]',
      params: { id: debt.id },
      key: debtReminderKey(debt.id),
    },
  });
  setDebtReminderNotificationId(debt.id, id);
}

export async function cancelDebtReminder(
  debt: Pick<Debt, 'id' | 'reminderNotificationId'>,
): Promise<void> {
  await cancelNotification(debt.reminderNotificationId);
  setDebtReminderNotificationId(debt.id, null);
}
