import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useColorScheme } from '@/hooks/use-color-scheme';

import {
  getBudgetSettings,
  getTransaction,
  listSavingsGoalsWithProgress,
  listTransactions,
} from '@/features/budget/services/budget-repository';
import {
  accountBalances,
  expenseByCategory,
  filterByRange,
  monthlyTrend,
  periodRange,
  summarize,
  type Period,
} from '@/features/budget/services/budget-stats';

export function useTransactions() {
  return useQuery({
    queryKey: ['budget', 'transactions'],
    queryFn: async () => listTransactions(),
  });
}

export function useTransaction(id: string | undefined) {
  return useQuery({
    queryKey: ['budget', 'transaction', id],
    queryFn: async () => (id ? getTransaction(id) : null),
    enabled: !!id,
  });
}

export function useSavingsGoals() {
  return useQuery({
    queryKey: ['budget', 'savings-goals'],
    queryFn: async () => listSavingsGoalsWithProgress(),
  });
}

export function useBudgetSettings() {
  return useQuery({ queryKey: ['budget', 'settings'], queryFn: async () => getBudgetSettings() });
}

/**
 * Aggregates the dashboard for a selected period (month by default). Summary,
 * expense donut, account balances and the 6-month trend are all derived from
 * the single cached transaction list.
 */
export function useBudgetOverview(period: Period, anchorTime: number) {
  const scheme = useColorScheme() ?? 'light';
  const { data: transactions = [], isLoading, isError, refetch } = useTransactions();
  const { data: settings } = useBudgetSettings();

  const currency = settings?.currency ?? '$';

  const value = useMemo(() => {
    const { start, end } = periodRange(period, new Date(anchorTime));
    const inPeriod = filterByRange(transactions, start, end);
    return {
      periodTransactions: inPeriod,
      summary: summarize(inPeriod),
      categories: expenseByCategory(inPeriod, scheme),
      accounts: accountBalances(transactions),
      trend: monthlyTrend(transactions, 6),
      hasAny: transactions.length > 0,
    };
  }, [transactions, period, anchorTime, scheme]);

  return {
    isLoading,
    isError,
    refetch,
    currency,
    monthlyBudgetCents: settings?.monthlyBudgetCents ?? null,
    ...value,
  };
}
