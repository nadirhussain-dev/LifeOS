import {
  endOfMonth,
  endOfWeek,
  endOfYear,
  format,
  startOfMonth,
  startOfWeek,
  startOfYear,
  subMonths,
} from 'date-fns';
import type { TFunction } from 'i18next';

import type { ThemeName } from '@/constants/design-tokens';

import { expenseCategoryMeta } from '@/features/budget/config/budget-config';
import type {
  AccountBalance,
  BudgetAccount,
  BudgetSummary,
  BudgetTransaction,
  BudgetTrendPoint,
  CategorySlice,
} from '@/features/budget/types/budget.types';

export type Period = 'week' | 'month' | 'year';

/** Inclusive [start, end] epoch bounds for the period containing `anchor`. */
export function periodRange(period: Period, anchor: Date): { start: number; end: number } {
  switch (period) {
    case 'week':
      return { start: startOfWeek(anchor).getTime(), end: endOfWeek(anchor).getTime() };
    case 'year':
      return { start: startOfYear(anchor).getTime(), end: endOfYear(anchor).getTime() };
    case 'month':
    default:
      return { start: startOfMonth(anchor).getTime(), end: endOfMonth(anchor).getTime() };
  }
}

export function filterByRange(
  transactions: BudgetTransaction[],
  start: number,
  end: number,
): BudgetTransaction[] {
  return transactions.filter((t) => t.occurredAt >= start && t.occurredAt <= end);
}

export function summarize(transactions: BudgetTransaction[]): BudgetSummary {
  let incomeCents = 0;
  let expenseCents = 0;
  let savingsCents = 0;
  for (const t of transactions) {
    if (t.type === 'income') incomeCents += t.amountCents;
    else if (t.type === 'expense') expenseCents += t.amountCents;
    else savingsCents += t.amountCents;
  }
  return {
    incomeCents,
    expenseCents,
    savingsCents,
    balanceCents: incomeCents - expenseCents - savingsCents,
  };
}

/** Expense totals per category, largest first, with each slice's share of the
 * total — feeds both the donut and the legend/breakdown list. */
export function expenseByCategory(
  transactions: BudgetTransaction[],
  theme: ThemeName,
): CategorySlice[] {
  const totals = new Map<string, number>();
  for (const t of transactions) {
    if (t.type !== 'expense') continue;
    totals.set(t.category, (totals.get(t.category) ?? 0) + t.amountCents);
  }
  const grand = [...totals.values()].reduce((sum, v) => sum + v, 0);
  if (grand === 0) return [];
  return [...totals.entries()]
    .map(([categoryId, amountCents]) => {
      const meta = expenseCategoryMeta(categoryId, theme);
      return {
        categoryId,
        label: meta.label,
        tint: meta.tint,
        amountCents,
        share: amountCents / grand,
      };
    })
    .sort((a, b) => b.amountCents - a.amountCents);
}

/** Running balance per account across ALL time: income adds, expense and
 * savings both remove spendable money. */
export function accountBalances(transactions: BudgetTransaction[]): AccountBalance[] {
  const accounts: BudgetAccount[] = ['cash', 'wallet', 'bank'];
  const byAccount = new Map<BudgetAccount, number>(accounts.map((a) => [a, 0]));
  for (const t of transactions) {
    const delta = t.type === 'income' ? t.amountCents : -t.amountCents;
    byAccount.set(t.account, (byAccount.get(t.account) ?? 0) + delta);
  }
  return accounts.map((account) => ({ account, balanceCents: byAccount.get(account) ?? 0 }));
}

/** Income-vs-expense per month for the trailing `months` months (oldest→newest). */
export function monthlyTrend(
  transactions: BudgetTransaction[],
  months: number,
): BudgetTrendPoint[] {
  const points: BudgetTrendPoint[] = [];
  for (let i = months - 1; i >= 0; i -= 1) {
    const anchor = subMonths(new Date(), i);
    const { start, end } = periodRange('month', anchor);
    const inMonth = filterByRange(transactions, start, end);
    const summary = summarize(inMonth);
    points.push({
      label: format(anchor, 'MMM'),
      incomeCents: summary.incomeCents,
      expenseCents: summary.expenseCents,
    });
  }
  return points;
}

export function periodLabel(period: Period, anchor: Date, t: TFunction, locale: string): string {
  if (period === 'week') {
    return t('budget.weekOf', {
      date: startOfWeek(anchor).toLocaleDateString(locale, { month: 'short', day: 'numeric' }),
    });
  }
  if (period === 'year') return String(anchor.getFullYear());
  return anchor.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
}
