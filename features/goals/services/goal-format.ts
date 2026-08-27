import { differenceInCalendarDays } from 'date-fns/differenceInCalendarDays';
import { format } from 'date-fns/format';
import { isToday } from 'date-fns/isToday';
import { isTomorrow } from 'date-fns/isTomorrow';
import type { TFunction } from 'i18next';

export type DueState = 'overdue' | 'today' | 'soon' | 'later';

export type DueInfo = { label: string; state: DueState };

/** Humanizes a goal's due date into a short label + urgency state so the card
 * and detail screen render it (and color it) the same way. */
export function formatDueDate(dueDate: number, t: TFunction): DueInfo {
  const date = new Date(dueDate);
  const days = differenceInCalendarDays(date, new Date());

  if (days < 0) {
    return {
      label: t('goals.overdueByDays', { count: Math.abs(days) }),
      state: 'overdue',
    };
  }
  if (isToday(date)) return { label: t('goals.dueToday'), state: 'today' };
  if (isTomorrow(date)) return { label: t('goals.dueTomorrow'), state: 'soon' };
  if (days <= 7) return { label: t('goals.dueInDays', { count: days }), state: 'soon' };
  return { label: t('goals.dueOn', { date: format(date, 'MMM d') }), state: 'later' };
}

export function formatProgressPercent(progress: number): string {
  return `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%`;
}
