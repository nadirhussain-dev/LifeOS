import { differenceInCalendarDays } from 'date-fns/differenceInCalendarDays';
import { parseISO } from 'date-fns/parseISO';

import type { SleepSession, SleepStats, SleepTrendPoint } from '@/features/sleep/types/sleep.types';

/** Minutes-past-midnight (0–1439) for an epoch timestamp, in local time. */
export function minutesOfDay(timestamp: number): number {
  const date = new Date(timestamp);
  return date.getHours() * 60 + date.getMinutes();
}

/** Formats a minutes-of-day value as "10:30 PM". */
export function formatClock(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60);
  const min = m % 60;
  const period = h24 < 12 ? 'AM' : 'PM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(min).padStart(2, '0')} ${period}`;
}

/** Formats a minute count as "7h 45m". */
export function formatDuration(totalMinutes: number): string {
  const mins = Math.max(0, Math.round(totalMinutes));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/**
 * Circular mean of a set of clock times (minutes-of-day), returned as
 * minutes-of-day, plus the mean resultant length R∈[0,1]. Clock times are
 * angular — 23:50 and 00:10 are 20 minutes apart, not 23h40m — so a plain
 * arithmetic mean would badly misplace bedtimes that straddle midnight. R
 * doubles as a consistency score: 1 = identical times, →0 = uniformly scattered.
 */
function circularMean(minutesList: number[]): { mean: number | null; r: number } {
  if (minutesList.length === 0) return { mean: null, r: 0 };
  let sinSum = 0;
  let cosSum = 0;
  for (const minutes of minutesList) {
    const angle = (minutes / 1440) * 2 * Math.PI;
    sinSum += Math.sin(angle);
    cosSum += Math.cos(angle);
  }
  const n = minutesList.length;
  const r = Math.sqrt(sinSum * sinSum + cosSum * cosSum) / n;
  let angle = Math.atan2(sinSum / n, cosSum / n);
  if (angle < 0) angle += 2 * Math.PI;
  const mean = (angle / (2 * Math.PI)) * 1440;
  return { mean, r };
}

/**
 * Length of the run of consecutive calendar days (no gaps) meeting the goal,
 * ending at the most recent tracked night. A missed night or an untracked gap
 * breaks the streak.
 */
function computeStreaks(
  sessions: SleepSession[],
  goalMinutes: number,
): { current: number; best: number } {
  if (sessions.length === 0) return { current: 0, best: 0 };
  // Newest first.
  const sorted = [...sessions].sort((a, b) => b.logDate.localeCompare(a.logDate));

  let best = 0;
  let run = 0;
  let prevDate: string | null = null;

  // Walk oldest→newest for "best": reset on a gap or a goal miss.
  const chrono = [...sorted].reverse();
  for (const session of chrono) {
    const met = session.durationMinutes >= goalMinutes;
    if (!met) {
      run = 0;
      prevDate = session.logDate;
      continue;
    }
    if (prevDate && differenceInCalendarDays(parseISO(session.logDate), parseISO(prevDate)) === 1) {
      run += 1;
    } else {
      run = 1;
    }
    best = Math.max(best, run);
    prevDate = session.logDate;
  }

  // Current: count back from the newest night while dates are consecutive and
  // the goal is met.
  let current = 0;
  let expected: string | null = null;
  for (const session of sorted) {
    if (session.durationMinutes < goalMinutes) break;
    if (expected === null) {
      current = 1;
    } else if (differenceInCalendarDays(parseISO(expected), parseISO(session.logDate)) === 1) {
      current += 1;
    } else {
      break;
    }
    expected = session.logDate;
  }

  return { current, best };
}

export function computeSleepStats(sessions: SleepSession[], goalMinutes: number): SleepStats {
  if (sessions.length === 0) {
    return {
      nightsTracked: 0,
      avgDurationMinutes: 0,
      currentStreak: 0,
      bestStreak: 0,
      consistency: 0,
      goalMetCount: 0,
      avgBedtimeMinutes: null,
      avgWakeMinutes: null,
      avgFellAsleepMinutes: null,
    };
  }

  const avgDuration = sessions.reduce((sum, s) => sum + s.durationMinutes, 0) / sessions.length;
  const { current, best } = computeStreaks(sessions, goalMinutes);
  const bed = circularMean(sessions.map((s) => minutesOfDay(s.bedtime)));
  const wake = circularMean(sessions.map((s) => minutesOfDay(s.wakeTime)));

  const withLatency = sessions.filter((s) => s.fellAsleepMinutes != null);
  const avgFellAsleep =
    withLatency.length > 0
      ? withLatency.reduce((sum, s) => sum + (s.fellAsleepMinutes ?? 0), 0) / withLatency.length
      : null;

  return {
    nightsTracked: sessions.length,
    avgDurationMinutes: avgDuration,
    currentStreak: current,
    bestStreak: best,
    consistency: bed.r,
    goalMetCount: sessions.filter((s) => s.durationMinutes >= goalMinutes).length,
    avgBedtimeMinutes: bed.mean,
    avgWakeMinutes: wake.mean,
    avgFellAsleepMinutes: avgFellAsleep,
  };
}

/** Builds an ordered (oldest→newest) trend series for the last `days` nights,
 * leaving gaps out (chart renders only tracked nights). */
export function buildTrend(
  sessions: SleepSession[],
  goalMinutes: number,
  days: number,
): SleepTrendPoint[] {
  const cutoff = differenceInCalendarDays;
  const today = new Date();
  return [...sessions]
    .filter((s) => cutoff(today, parseISO(s.logDate)) < days)
    .sort((a, b) => a.logDate.localeCompare(b.logDate))
    .map((s) => ({
      date: s.logDate,
      durationMinutes: s.durationMinutes,
      metGoal: s.durationMinutes >= goalMinutes,
    }));
}

/** wake − bed in whole minutes; callers guarantee wake ≥ bed by rolling the
 * wake timestamp to the next day when the clock time is earlier. */
export function durationBetween(bedtime: number, wakeTime: number): number {
  return Math.max(0, Math.round((wakeTime - bedtime) / 60000));
}
