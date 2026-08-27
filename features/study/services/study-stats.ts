import { differenceInCalendarDays } from 'date-fns/differenceInCalendarDays';
import { format } from 'date-fns/format';
import { parseISO } from 'date-fns/parseISO';
import { subDays } from 'date-fns/subDays';

import type {
  StudyInsights,
  StudySession,
  StudyStats,
  StudySubject,
  StudyTrendPoint,
  SubjectBreakdown,
  TimeOfDay,
} from '@/features/study/types/study.types';

export function todayKey(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

/** "1h 25m" / "45m" / "0m" from a second count. */
export function formatStudyDuration(totalSeconds: number): string {
  const mins = Math.floor(totalSeconds / 60);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** "25:00" mm:ss for the live timer. */
export function formatTimer(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function sumSeconds(sessions: StudySession[]): number {
  return sessions.reduce((sum, s) => sum + s.durationSeconds, 0);
}

/** Consecutive study days ending today or yesterday (a gap of one day is
 * tolerated only at the leading edge so "studied yesterday, not yet today"
 * still counts). */
function computeStreaks(sessions: StudySession[]): { current: number; best: number } {
  const days = Array.from(new Set(sessions.map((s) => s.logDate))).sort(); // ascending
  if (days.length === 0) return { current: 0, best: 0 };

  let best = 1;
  let run = 1;
  for (let i = 1; i < days.length; i += 1) {
    const gap = differenceInCalendarDays(parseISO(days[i]), parseISO(days[i - 1]));
    run = gap === 1 ? run + 1 : 1;
    best = Math.max(best, run);
  }

  // Current: walk back from the most recent studied day if it's today/yesterday.
  const today = new Date();
  const last = days[days.length - 1];
  const lag = differenceInCalendarDays(today, parseISO(last));
  let current = 0;
  if (lag <= 1) {
    current = 1;
    for (let i = days.length - 2; i >= 0; i -= 1) {
      if (differenceInCalendarDays(parseISO(days[i + 1]), parseISO(days[i])) === 1) current += 1;
      else break;
    }
  }
  return { current, best };
}

export function computeStudyStats(sessions: StudySession[]): StudyStats {
  const today = todayKey();
  const weekAgo = format(subDays(new Date(), 6), 'yyyy-MM-dd');
  const monthAgo = format(subDays(new Date(), 29), 'yyyy-MM-dd');

  const { current, best } = computeStreaks(sessions);

  return {
    todaySeconds: sumSeconds(sessions.filter((s) => s.logDate === today)),
    weekSeconds: sumSeconds(sessions.filter((s) => s.logDate >= weekAgo)),
    monthSeconds: sumSeconds(sessions.filter((s) => s.logDate >= monthAgo)),
    totalSeconds: sumSeconds(sessions),
    sessionCount: sessions.length,
    currentStreak: current,
    bestStreak: best,
  };
}

const TIME_OF_DAY_LABEL_KEY: Record<TimeOfDay, string> = {
  morning: 'study.morning',
  afternoon: 'study.afternoon',
  evening: 'study.evening',
  night: 'study.night',
};

/** Translation key for a time-of-day bucket — resolved by the caller's `t`. */
export function timeOfDayLabelKey(bucket: TimeOfDay): string {
  return TIME_OF_DAY_LABEL_KEY[bucket];
}

function timeOfDayOf(timestamp: number): TimeOfDay {
  const hour = new Date(timestamp).getHours();
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 22) return 'evening';
  return 'night';
}

/** Actionable "how to improve" signals: typical session length, focus quality,
 * the part of day you focus best, and momentum vs last week. */
export function computeStudyInsights(sessions: StudySession[]): StudyInsights {
  const total = sumSeconds(sessions);
  const avgSessionSeconds = sessions.length > 0 ? total / sessions.length : 0;

  const rated = sessions.filter((s) => s.focusRating != null);
  const avgFocusRating =
    rated.length > 0
      ? rated.reduce((sum, s) => sum + (s.focusRating ?? 0), 0) / rated.length
      : null;

  const byBucket = new Map<TimeOfDay, number>();
  for (const session of sessions) {
    const bucket = timeOfDayOf(session.startedAt);
    byBucket.set(bucket, (byBucket.get(bucket) ?? 0) + session.durationSeconds);
  }
  let bestTimeOfDay: TimeOfDay | null = null;
  let bestSeconds = 0;
  for (const [bucket, seconds] of byBucket) {
    if (seconds > bestSeconds) {
      bestSeconds = seconds;
      bestTimeOfDay = bucket;
    }
  }

  const weekAgo = format(subDays(new Date(), 6), 'yyyy-MM-dd');
  const twoWeeksAgo = format(subDays(new Date(), 13), 'yyyy-MM-dd');
  const thisWeekSeconds = sumSeconds(sessions.filter((s) => s.logDate >= weekAgo));
  const lastWeekSeconds = sumSeconds(
    sessions.filter((s) => s.logDate >= twoWeeksAgo && s.logDate < weekAgo),
  );
  const weekOverWeek =
    lastWeekSeconds > 0 ? (thisWeekSeconds - lastWeekSeconds) / lastWeekSeconds : null;

  return { avgSessionSeconds, avgFocusRating, bestTimeOfDay, weekOverWeek, thisWeekSeconds };
}

export function subjectBreakdown(
  sessions: StudySession[],
  subjects: StudySubject[],
  sinceDate?: string,
): SubjectBreakdown[] {
  const relevant = sinceDate ? sessions.filter((s) => s.logDate >= sinceDate) : sessions;
  const byId = new Map<string | null, number>();
  for (const session of relevant) {
    byId.set(session.subjectId, (byId.get(session.subjectId) ?? 0) + session.durationSeconds);
  }
  const subjectById = new Map(subjects.map((s) => [s.id, s]));
  return [...byId.entries()]
    .map(([id, seconds]) => ({ subject: id ? (subjectById.get(id) ?? null) : null, seconds }))
    .filter((entry) => entry.seconds > 0)
    .sort((a, b) => b.seconds - a.seconds);
}

/** Daily totals for the last `days` days (oldest→newest), zero-filled so the
 * chart shows every day including rest days. */
export function buildStudyTrend(
  sessions: StudySession[],
  days: number,
  dailyGoalSeconds: number,
): StudyTrendPoint[] {
  const totals = new Map<string, number>();
  for (const session of sessions) {
    totals.set(session.logDate, (totals.get(session.logDate) ?? 0) + session.durationSeconds);
  }
  const points: StudyTrendPoint[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const date = format(subDays(new Date(), i), 'yyyy-MM-dd');
    const seconds = totals.get(date) ?? 0;
    points.push({ date, seconds, metGoal: seconds >= dailyGoalSeconds });
  }
  return points;
}
