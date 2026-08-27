import { differenceInCalendarDays } from 'date-fns/differenceInCalendarDays';
import type { TFunction } from 'i18next';

import { colors } from '@/constants/design-tokens';
import type { Debt, DebtStatus, DebtWithStatus } from '@/features/budget/types/budget.types';

/** A debt is "due soon" once it's within this many days of its deadline. */
export const DUE_SOON_DAYS = 3;

/** Presets offered in the form for "remind me N days before the deadline". */
export const REMINDER_DAY_OPTIONS = [0, 1, 2, 3, 7];

/** Whole calendar days from today until the deadline. Negative = overdue,
 * 0 = due today. `null` when the debt has no deadline. */
export function daysUntil(dueDate: number | null, now = Date.now()): number | null {
  if (dueDate == null) return null;
  return differenceInCalendarDays(new Date(dueDate), new Date(now));
}

/** Derives remaining balance, progress, and a colour-coded status for a debt. */
export function withStatus(debt: Debt, now = Date.now()): DebtWithStatus {
  const remainingCents = Math.max(0, debt.principalCents - debt.paidCents);
  const isSettled = debt.settledAt != null || remainingCents === 0;
  const daysLeft = daysUntil(debt.dueDate, now);

  let status: DebtStatus;
  if (isSettled) status = 'settled';
  else if (daysLeft == null) status = 'no_date';
  else if (daysLeft < 0) status = 'overdue';
  else if (daysLeft <= DUE_SOON_DAYS) status = 'due_soon';
  else status = 'upcoming';

  const progress = debt.principalCents > 0 ? Math.min(1, debt.paidCents / debt.principalCents) : 0;

  return { ...debt, remainingCents, progress, isSettled, daysLeft, status };
}

/** Short human label for a debt's timing, e.g. "3 days left", "Overdue by 2
 * days", "Due today", "Settled". */
export function statusLabel(d: DebtWithStatus, t: TFunction): string {
  if (d.isSettled) return t('debtStatus.settled');
  if (d.daysLeft == null) return t('debtStatus.noDeadline');
  if (d.daysLeft < 0) return t('debtStatus.overdueByDays', { count: Math.abs(d.daysLeft) });
  if (d.daysLeft === 0) return t('debtStatus.dueToday');
  return t('debtStatus.daysLeft', { count: d.daysLeft });
}

/** Status → accent colour (semantic tokens for the traffic-light states; the
 *  neutral "upcoming / no deadline" state keeps the debts sub-identity tint). */
export function statusTint(status: DebtStatus): string {
  switch (status) {
    case 'overdue':
      return colors.light.error;
    case 'due_soon':
      return colors.light.warning;
    case 'settled':
      return colors.light.success;
    default:
      return '#6366f1';
  }
}
