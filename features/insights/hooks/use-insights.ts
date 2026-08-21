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
import { useModuleGate } from '@/features/module-flags/hooks/use-module-access';
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
 *
 * Every input is gated on its own module first. Insights is the widest
 * cross-module read in the app — it is the whole point of the screen — which
 * also makes it the one place where switching a module off can be undone by
 * something outside it: a privatised Sleep still produced "you sleep better on
 * days you journal", naming sleep data on an unlocked screen, and a module the
 * operator had pulled still shaped correlations the user could no longer open.
 *
 * `notification-visibility.ts` already assumes this: the `review` category maps
 * to no module "because what the review itself shows is filtered by the data it
 * reads". It reads this hook, and until now nothing filtered it.
 *
 * A gated module contributes an empty series rather than being dropped from the
 * join, so the day rows keep their shape and the correlation engine simply
 * finds nothing to say about it — the same answer it gives for a module you
 * have never used.
 */
export function useLifeInsights(rangeDays: number) {
  const allowed = useModuleGate();
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
  } = useQuery({
    queryKey: ['habits', false],
    queryFn: async () => listHabitsWithToday(false),
    enabled: allowed('habits'),
  });

  const {
    data: habitLogs = [],
    isLoading: habitLogsLoading,
    isError: habitLogsError,
    refetch: refetchHabitLogs,
  } = useQuery({
    queryKey: ['insights', 'habit-logs', start, end],
    queryFn: async () => listAllHabitLogsBetween(start, end),
    enabled: allowed('habits'),
  });

  const {
    data: journalEntries = [],
    isLoading: journalLoading,
    isError: journalError,
    refetch: refetchJournal,
  } = useQuery({
    queryKey: ['insights', 'journal-entries', start, end],
    queryFn: async () => listEntriesBetween(start, end),
    enabled: allowed('journal'),
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
    enabled: allowed('tasks'),
  });

  const {
    data: waterTotals = [],
    isLoading: waterLoading,
    isError: waterError,
    refetch: refetchWater,
  } = useQuery({
    queryKey: ['insights', 'water', start, end],
    queryFn: async () => listDailyTotals(start, end),
    enabled: allowed('water'),
  });

  /**
   * The gate is applied here as well as on the queries above, and that is not
   * belt-and-braces: `useSleepSessions`, `useStudySessions` and `useTransactions`
   * are the modules' own hooks, shared with their own screens, so their caches
   * are already warm and `enabled` on this hook's queries cannot reach them.
   * Masking at the join is the part that actually holds; `enabled` above only
   * saves the reads this hook owns.
   */
  const daily = useMemo(
    () =>
      buildDailyMetrics({
        days: rangeDays,
        sleepSessions: allowed('sleep') ? sleepSessions : [],
        studySessions: allowed('study') ? studySessions : [],
        habits: allowed('habits') ? habits : [],
        habitLogs: allowed('habits') ? habitLogs : [],
        transactions: allowed('budget') ? transactions : [],
        journalEntries: allowed('journal') ? journalEntries : [],
        tasks: allowed('tasks') ? tasks : [],
        waterTotals: allowed('water') ? waterTotals : [],
      }),
    [
      rangeDays,
      allowed,
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
