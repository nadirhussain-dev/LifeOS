import { format, subDays } from 'date-fns';

import { isHabitScheduledOn } from '@/features/habits/services/habit-streaks';
import type { Habit, HabitLog } from '@/features/habits/types/habit.types';
import type { BudgetTransaction } from '@/features/budget/types/budget.types';
import type { DailyMetrics } from '@/features/insights/types/insights.types';
import type { JournalEntry } from '@/features/journal/types/journal.types';
import type { SleepSession } from '@/features/sleep/types/sleep.types';
import type { StudySession } from '@/features/study/types/study.types';

type BuildParams = {
  days: number;
  sleepSessions: SleepSession[];
  studySessions: StudySession[];
  habits: Habit[];
  habitLogs: HabitLog[];
  transactions: BudgetTransaction[];
  journalEntries: JournalEntry[];
};

/**
 * Joins every module's daily figure onto one row per calendar day, keyed by
 * the `yyyy-MM-dd` string every table already uses — journal's `entryDate` is
 * the one field with a different name, normalized here rather than in the
 * schema. Zero/null-filled across the full range so a day nothing was logged
 * still has a row for the engine to compare against.
 */
export function buildDailyMetrics({
  days,
  sleepSessions,
  studySessions,
  habits,
  habitLogs,
  transactions,
  journalEntries,
}: BuildParams): DailyMetrics[] {
  const byDate = new Map<string, DailyMetrics>();
  for (let i = days - 1; i >= 0; i -= 1) {
    const date = format(subDays(new Date(), i), 'yyyy-MM-dd');
    byDate.set(date, {
      date,
      sleepMinutes: null,
      sleepQuality: null,
      fellAsleepMinutes: null,
      studySeconds: 0,
      focusRating: null,
      habitsScheduled: 0,
      habitsCompleted: 0,
      spendCents: 0,
      mood: null,
    });
  }

  for (const session of sleepSessions) {
    const row = byDate.get(session.logDate);
    if (!row) continue;
    row.sleepMinutes = session.durationMinutes;
    row.sleepQuality = session.quality;
    row.fellAsleepMinutes = session.fellAsleepMinutes;
  }

  const studySecondsByDate = new Map<string, number>();
  const focusRatingsByDate = new Map<string, number[]>();
  for (const session of studySessions) {
    if (!byDate.has(session.logDate)) continue;
    studySecondsByDate.set(
      session.logDate,
      (studySecondsByDate.get(session.logDate) ?? 0) + session.durationSeconds,
    );
    if (session.focusRating != null) {
      const ratings = focusRatingsByDate.get(session.logDate) ?? [];
      ratings.push(session.focusRating);
      focusRatingsByDate.set(session.logDate, ratings);
    }
  }
  for (const [date, seconds] of studySecondsByDate) {
    const row = byDate.get(date);
    if (row) row.studySeconds = seconds;
  }
  for (const [date, ratings] of focusRatingsByDate) {
    const row = byDate.get(date);
    if (row) row.focusRating = ratings.reduce((sum, r) => sum + r, 0) / ratings.length;
  }

  const logsByDate = new Map<string, HabitLog[]>();
  for (const log of habitLogs) {
    const list = logsByDate.get(log.logDate) ?? [];
    list.push(log);
    logsByDate.set(log.logDate, list);
  }
  for (const [date, row] of byDate) {
    const loggedHabitIds = new Set((logsByDate.get(date) ?? []).map((log) => log.habitId));
    let scheduled = 0;
    for (const habit of habits) {
      if (isHabitScheduledOn(habit, date)) scheduled += 1;
    }
    row.habitsScheduled = scheduled;
    row.habitsCompleted = loggedHabitIds.size;
  }

  for (const tx of transactions) {
    if (tx.type !== 'expense') continue;
    const row = byDate.get(tx.logDate);
    if (row) row.spendCents += tx.amountCents;
  }

  for (const entry of journalEntries) {
    const row = byDate.get(entry.entryDate);
    if (row) row.mood = entry.mood;
  }

  return [...byDate.values()];
}
