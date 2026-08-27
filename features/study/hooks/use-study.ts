import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import {
  getStudySettings,
  listStudySessions,
  listStudySubjects,
} from '@/features/study/services/study-repository';
import {
  buildStudyTrend,
  computeStudyInsights,
  computeStudyStats,
  subjectBreakdown,
  todayKey,
} from '@/features/study/services/study-stats';
import { format } from 'date-fns/format';
import { subDays } from 'date-fns/subDays';

export function useStudySubjects() {
  return useQuery({ queryKey: ['study', 'subjects'], queryFn: async () => listStudySubjects() });
}

export function useStudySessions() {
  return useQuery({ queryKey: ['study', 'sessions'], queryFn: async () => listStudySessions() });
}

export function useStudySettings() {
  return useQuery({ queryKey: ['study', 'settings'], queryFn: async () => getStudySettings() });
}

/** Aggregates the study dashboard: today's progress vs goal, headline stats,
 * subject split and the daily trend series. */
export function useStudyInsights(rangeDays: number) {
  const {
    data: sessions = [],
    isLoading: sessionsLoading,
    isError: sessionsError,
    refetch: refetchSessions,
  } = useStudySessions();
  const {
    data: subjects = [],
    isLoading: subjectsLoading,
    isError: subjectsError,
    refetch: refetchSubjects,
  } = useStudySubjects();
  const {
    data: settings,
    isLoading: settingsLoading,
    isError: settingsError,
    refetch: refetchSettings,
  } = useStudySettings();

  const dailyGoalMinutes = settings?.dailyGoalMinutes ?? 120;
  const dailyGoalSeconds = dailyGoalMinutes * 60;

  const stats = useMemo(() => computeStudyStats(sessions), [sessions]);
  const trend = useMemo(
    () => buildStudyTrend(sessions, rangeDays, dailyGoalSeconds),
    [sessions, rangeDays, dailyGoalSeconds],
  );
  const breakdown = useMemo(
    () => subjectBreakdown(sessions, subjects, format(subDays(new Date(), 6), 'yyyy-MM-dd')),
    [sessions, subjects],
  );
  const insights = useMemo(() => computeStudyInsights(sessions), [sessions]);

  return {
    isLoading: sessionsLoading || subjectsLoading || settingsLoading,
    isError: sessionsError || subjectsError || settingsError,
    refetch: () => {
      void refetchSessions();
      void refetchSubjects();
      void refetchSettings();
    },
    sessions,
    subjects,
    settings: settings ?? { dailyGoalMinutes, focusMinutes: 25, breakMinutes: 5 },
    dailyGoalSeconds,
    stats,
    trend,
    breakdown,
    insights,
    todayKey: todayKey(),
  };
}
