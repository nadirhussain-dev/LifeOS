import { useQuery } from '@tanstack/react-query';
import { format, subDays } from 'date-fns';
import { useMemo } from 'react';

import { useTransactions } from '@/features/budget/hooks/use-budget';
import {
  listAllHabitLogsBetween,
  listHabitsWithToday,
} from '@/features/habits/services/habits-repository';
import { buildDailyMetrics } from '@/features/insights/services/daily-metrics';
import { computeInsights } from '@/features/insights/services/insight-engine';
import { listEntriesBetween } from '@/features/journal/services/journal-repository';
import { useSleepSessions } from '@/features/sleep/hooks/use-sleep';
import { useStudySessions } from '@/features/study/hooks/use-study';

/**
 * Aggregates the Insights screen: pulls sleep, study, budget, habit and
 * journal data for the range, joins it into one row per day, and runs the
 * correlation engine over the join. `habits`/`habit logs` and `journal
 * entries` use their own range-scoped queries here (rather than the
 * search/archive-filtered `useHabits()` or the visible-month `useJournalMonth()`)
 * because those hooks are shaped for their own screens, not a cross-module
 * date range — the habits query shares its cache key with `useHabits()` so
 * the same data isn't fetched twice.
 */
export function useLifeInsights(rangeDays: number) {
  const {
    data: sleepSessions = [],
    isLoading: sleepLoading,
    isError: sleepError,
    refetch: refetchSleep,
  } = useSleepSessions();
  const {
    data: studySessions = [],
    isLoading: studyLoading,
    isError: studyError,
    refetch: refetchStudy,
  } = useStudySessions();
  const {
    data: transactions = [],
    isLoading: budgetLoading,
    isError: budgetError,
    refetch: refetchBudget,
  } = useTransactions();

  const start = format(subDays(new Date(), rangeDays - 1), 'yyyy-MM-dd');
  const end = format(new Date(), 'yyyy-MM-dd');

  const {
    data: habits = [],
    isLoading: habitsLoading,
    isError: habitsError,
    refetch: refetchHabits,
  } = useQuery({ queryKey: ['habits', false], queryFn: async () => listHabitsWithToday(false) });

  const {
    data: habitLogs = [],
    isLoading: habitLogsLoading,
    isError: habitLogsError,
    refetch: refetchHabitLogs,
  } = useQuery({
    queryKey: ['insights', 'habit-logs', start, end],
    queryFn: async () => listAllHabitLogsBetween(start, end),
  });

  const {
    data: journalEntries = [],
    isLoading: journalLoading,
    isError: journalError,
    refetch: refetchJournal,
  } = useQuery({
    queryKey: ['insights', 'journal-entries', start, end],
    queryFn: async () => listEntriesBetween(start, end),
  });

  const daily = useMemo(
    () =>
      buildDailyMetrics({
        days: rangeDays,
        sleepSessions,
        studySessions,
        habits,
        habitLogs,
        transactions,
        journalEntries,
      }),
    [rangeDays, sleepSessions, studySessions, habits, habitLogs, transactions, journalEntries],
  );

  const insights = useMemo(() => computeInsights(daily), [daily]);

  return {
    isLoading:
      sleepLoading ||
      studyLoading ||
      budgetLoading ||
      habitsLoading ||
      habitLogsLoading ||
      journalLoading,
    isError:
      sleepError || studyError || budgetError || habitsError || habitLogsError || journalError,
    refetch: () => {
      void refetchSleep();
      void refetchStudy();
      void refetchBudget();
      void refetchHabits();
      void refetchHabitLogs();
      void refetchJournal();
    },
    daily,
    insights,
  };
}
