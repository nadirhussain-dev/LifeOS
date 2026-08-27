import { format } from 'date-fns/format';
import { getHours } from 'date-fns/getHours';
import { getMinutes } from 'date-fns/getMinutes';
import { subDays } from 'date-fns/subDays';

import type { BudgetTransaction } from '@/features/budget/types/budget.types';
import { isHabitScheduledOn } from '@/features/habits/services/habit-streaks';
import type { Habit, HabitLog } from '@/features/habits/types/habit.types';
import type { DailyMetrics } from '@/features/insights/types/insights.types';
import type { JournalEntry, MoodOption } from '@/features/journal/types/journal.types';
import type { SleepSession } from '@/features/sleep/types/sleep.types';
import type { StudySession } from '@/features/study/types/study.types';
import type { Task } from '@/features/tasks/types/task.types';
import type { DailyWaterTotal } from '@/features/water-intake/types/water-intake.types';

type BuildParams = {
  days: number;
  sleepSessions: SleepSession[];
  studySessions: StudySession[];
  habits: Habit[];
  habitLogs: HabitLog[];
  transactions: BudgetTransaction[];
  journalEntries: JournalEntry[];
  tasks: Task[];
  /** Already summed per day by the water repository — this is the one module
   *  that hands over totals rather than rows, because `listDailyTotals` exists
   *  and re-summing the logs here would be a second implementation of the same
   *  arithmetic. */
  waterTotals: DailyWaterTotal[];
};

/** Mood as a number so it can be an outcome as well as a filter. Evenly
 *  spaced because nothing here justifies claiming "good" is closer to "great"
 *  than "okay" is to "good". */
const MOOD_SCORE: Record<MoodOption, number> = {
  rough: 1,
  low: 2,
  okay: 3,
  good: 4,
  great: 5,
};

/**
 * Clock time as minutes after noon.
 *
 * Bedtimes cannot be averaged as clock times. 23:30 and 00:30 are half an hour
 * apart, and averaging them as 1410 and 30 gives 12:00 — midday, the furthest
 * possible point from both. Anchoring at noon puts an ordinary night's range on
 * one continuous increasing scale, so "later" is reliably a bigger number and
 * the mean of two adjacent nights lands between them.
 */
function minutesAfterNoon(timestamp: number): number {
  const minutes = getHours(timestamp) * 60 + getMinutes(timestamp);
  const NOON = 12 * 60;
  return minutes >= NOON ? minutes - NOON : minutes + (24 * 60 - NOON);
}

function countWords(body: string): number {
  const trimmed = body.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}

function emptyDay(date: string): DailyMetrics {
  return {
    date,
    sleepMinutes: null,
    sleepQuality: null,
    fellAsleepMinutes: null,
    bedtimeOffsetMinutes: null,
    wakeOffsetMinutes: null,
    studySeconds: 0,
    focusRating: null,
    habitsScheduled: 0,
    habitsCompleted: 0,
    spendCents: 0,
    mood: null,
    moodScore: null,
    energy: null,
    stress: null,
    journalWords: 0,
    tasksCompleted: 0,
    tasksDue: 0,
    waterMl: 0,
  };
}

/**
 * Joins every module's daily figure onto one row per calendar day, keyed by the
 * `yyyy-MM-dd` string every table already uses — journal's `entryDate` is the
 * one field with a different name, normalized here rather than in the schema.
 *
 * Zero/null-filled across the full range so a day nothing was logged still has a
 * row to compare against. The distinction between 0 and null is load-bearing:
 * zero spend is a fact about a day, while a missing sleep session is an absence
 * of information, and averaging those together is how a correlation engine ends
 * up reporting that not logging your sleep improves your mood.
 */
export function buildDailyMetrics({
  days,
  sleepSessions,
  studySessions,
  habits,
  habitLogs,
  transactions,
  journalEntries,
  tasks,
  waterTotals,
}: BuildParams): DailyMetrics[] {
  const byDate = new Map<string, DailyMetrics>();
  for (let i = days - 1; i >= 0; i -= 1) {
    const date = format(subDays(new Date(), i), 'yyyy-MM-dd');
    byDate.set(date, emptyDay(date));
  }

  for (const session of sleepSessions) {
    const row = byDate.get(session.logDate);
    if (!row) continue;
    row.sleepMinutes = session.durationMinutes;
    row.sleepQuality = session.quality;
    row.fellAsleepMinutes = session.fellAsleepMinutes;
    row.bedtimeOffsetMinutes = minutesAfterNoon(session.bedtime);
    row.wakeOffsetMinutes = minutesAfterNoon(session.wakeTime);
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
    if (!row) continue;
    row.mood = entry.mood;
    row.moodScore = entry.mood ? MOOD_SCORE[entry.mood] : null;
    row.energy = entry.energy;
    row.stress = entry.stress;
    row.journalWords = countWords(entry.body);
  }

  for (const task of tasks) {
    // Completion is filed against the day it happened; due is filed against the
    // day it was owed. Using one date for both would make "did I do what I
    // planned" unanswerable, which is the only thing these two are for.
    if (task.completedAt != null) {
      const row = byDate.get(format(task.completedAt, 'yyyy-MM-dd'));
      if (row) row.tasksCompleted += 1;
    }
    if (task.dueDate != null) {
      const row = byDate.get(format(task.dueDate, 'yyyy-MM-dd'));
      if (row) row.tasksDue += 1;
    }
  }

  for (const total of waterTotals) {
    const row = byDate.get(total.date);
    if (row) row.waterMl = total.totalMl;
  }

  return [...byDate.values()];
}
