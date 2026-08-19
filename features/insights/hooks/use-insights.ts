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
import { listTasks } from '@/features/tasks/services/tasks-repository';
import { listDailyTotals } from '@/features/water-intake/services/water-intake-repository';
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

  const {
    data: tasks = [],
    isLoading: tasksLoading,
    isError: tasksError,
    refetch: refetchTasks,
  } = useQuery({
    // Every task, not the filtered list the tasks screen shows: a completion is
    // filed against the day it happened, and an archived or completed task is
    // exactly the evidence this needs.
    queryKey: ['insights', 'tasks'],
    queryFn: async () => [
      ...listTasks('active', 'created'),
      ...listTasks('completed', 'created'),
      ...listTasks('archived', 'created'),
    ],
  });

  const {
    data: waterTotals = [],
    isLoading: waterLoading,
    isError: waterError,
    refetch: refetchWater,
  } = useQuery({
    queryKey: ['insights', 'water', start, end],
    queryFn: async () => listDailyTotals(start, end),
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
        tasks,
        waterTotals,
      }),
    [
      rangeDays,
      sleepSessions,
      studySessions,
      habits,
      habitLogs,
      transactions,
      journalEntries,
      tasks,
      waterTotals,
    ],
  );

  const insights = useMemo(() => computeInsights(daily), [daily]);

  return {
    isLoading:
      sleepLoading ||
      studyLoading ||
      budgetLoading ||
      habitsLoading ||
      habitLogsLoading ||
      journalLoading ||
      tasksLoading ||
      waterLoading,
    isError:
      sleepError ||
      studyError ||
      budgetError ||
      habitsError ||
      habitLogsError ||
      journalError ||
      tasksError ||
      waterError,
    refetch: () => {
      void refetchSleep();
      void refetchStudy();
      void refetchBudget();
      void refetchHabits();
      void refetchHabitLogs();
      void refetchJournal();
      void refetchTasks();
      void refetchWater();
    },
    daily,
    insights,
  };
}
