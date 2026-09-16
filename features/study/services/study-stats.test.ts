import { format } from 'date-fns/format';
import { subDays } from 'date-fns/subDays';

import {
  buildStudyTrend,
  computeStudyInsights,
  computeStudyStats,
  formatStudyDuration,
  formatTimer,
  subjectBreakdown,
  timeOfDayLabelKey,
} from '@/features/study/services/study-stats';
import type { StudySession, StudySubject } from '@/features/study/types/study.types';

/**
 * The numbers on the Study screen, and the first tests `features/study` has had.
 *
 * Two things here are worth more care than they look. The streak tolerates a
 * one-day gap *only* at the leading edge, so "studied yesterday, not yet today"
 * still reads as a live streak — a rule that is easy to widen by accident into
 * one that never breaks. And `weekOverWeek` divides by last week's total, which
 * is zero for everybody in their first fortnight; returning 0 rather than null
 * there would render as "0% change" for somebody who has no comparison yet.
 */

const iso = (daysAgo: number) => format(subDays(new Date(), daysAgo), 'yyyy-MM-dd');

/** A session, with only the fields the statistics read set explicitly. */
function session(overrides: Partial<StudySession> & { logDate: string }): StudySession {
  return {
    id: `s-${overrides.logDate}-${overrides.startedAt ?? 0}`,
    subjectId: null,
    startedAt: Date.now(),
    endedAt: Date.now(),
    durationSeconds: 1800,
    mode: 'pomodoro',
    focusRating: null,
    note: null,
    createdAt: 0,
    ...overrides,
  };
}

/** Local epoch ms at a given hour today, since the bucket reads local hours. */
const atHour = (hour: number) => new Date(2026, 5, 15, hour, 0, 0).getTime();

describe('formatStudyDuration', () => {
  it('drops the empty half of the pair', () => {
    expect(formatStudyDuration(0)).toBe('0m');
    expect(formatStudyDuration(2700)).toBe('45m');
    expect(formatStudyDuration(3600)).toBe('1h');
    expect(formatStudyDuration(5100)).toBe('1h 25m');
  });

  it('floors partial minutes rather than rounding up', () => {
    // 59 seconds of study is not "1m". Rounding up would let a run of aborted
    // sessions add minutes nobody sat through.
    expect(formatStudyDuration(59)).toBe('0m');
    expect(formatStudyDuration(119)).toBe('1m');
  });
});

describe('formatTimer', () => {
  it('pads both halves so the timer does not jump width', () => {
    expect(formatTimer(0)).toBe('00:00');
    expect(formatTimer(65)).toBe('01:05');
    expect(formatTimer(1500)).toBe('25:00');
  });

  it('clamps a negative remainder to zero', () => {
    // A timer that overshoots its deadline between ticks would otherwise
    // render "-1:-3".
    expect(formatTimer(-5)).toBe('00:00');
  });

  it('keeps counting past an hour rather than wrapping', () => {
    // mm:ss with no hour field: 90 minutes must read 90:00, not 30:00.
    expect(formatTimer(5400)).toBe('90:00');
  });
});

describe('computeStudyStats', () => {
  it('reports a zeroed shape for no sessions', () => {
    expect(computeStudyStats([])).toEqual({
      todaySeconds: 0,
      weekSeconds: 0,
      monthSeconds: 0,
      totalSeconds: 0,
      sessionCount: 0,
      currentStreak: 0,
      bestStreak: 0,
    });
  });

  it('separates today, the week, the month and all time', () => {
    const sessions = [
      session({ logDate: iso(0), durationSeconds: 600 }),
      session({ logDate: iso(3), durationSeconds: 900 }),
      session({ logDate: iso(20), durationSeconds: 1200 }),
      session({ logDate: iso(90), durationSeconds: 1500 }),
    ];

    const stats = computeStudyStats(sessions);

    expect(stats.todaySeconds).toBe(600);
    expect(stats.weekSeconds).toBe(1500); // today + 3 days ago
    expect(stats.monthSeconds).toBe(2700); // + 20 days ago
    expect(stats.totalSeconds).toBe(4200);
    expect(stats.sessionCount).toBe(4);
  });

  it('sums several sessions on the same day', () => {
    const stats = computeStudyStats([
      session({ logDate: iso(0), durationSeconds: 600, startedAt: 1 }),
      session({ logDate: iso(0), durationSeconds: 900, startedAt: 2 }),
    ]);

    expect(stats.todaySeconds).toBe(1500);
  });
});

describe('streaks', () => {
  it('counts consecutive days once each, however many sessions they hold', () => {
    // Three sessions in one day is one day of the streak, not three.
    const stats = computeStudyStats([
      session({ logDate: iso(0), startedAt: 1 }),
      session({ logDate: iso(0), startedAt: 2 }),
      session({ logDate: iso(1), startedAt: 3 }),
    ]);

    expect(stats.currentStreak).toBe(2);
  });

  it('keeps the streak alive when today has not been studied yet', () => {
    // The documented leading-edge tolerance. Somebody who studied yesterday
    // and opens the app at breakfast should not be told their streak is gone.
    const stats = computeStudyStats([session({ logDate: iso(1) }), session({ logDate: iso(2) })]);

    expect(stats.currentStreak).toBe(2);
  });

  it('breaks the streak once two days have passed', () => {
    // The other side of that tolerance: it applies at the leading edge only.
    const stats = computeStudyStats([session({ logDate: iso(2) }), session({ logDate: iso(3) })]);

    expect(stats.currentStreak).toBe(0);
  });

  it('does not tolerate a gap in the middle of a run', () => {
    // iso(2) is missing. If the gap rule leaked inward the streak would never
    // break, which is a streak that means nothing.
    const stats = computeStudyStats([
      session({ logDate: iso(0) }),
      session({ logDate: iso(1) }),
      session({ logDate: iso(3) }),
      session({ logDate: iso(4) }),
    ]);

    expect(stats.currentStreak).toBe(2);
  });

  it('keeps a best streak the current run has already lost', () => {
    const stats = computeStudyStats([
      session({ logDate: iso(10) }),
      session({ logDate: iso(9) }),
      session({ logDate: iso(8) }),
      session({ logDate: iso(7) }),
      // gap
      session({ logDate: iso(0) }),
    ]);

    expect(stats.currentStreak).toBe(1);
    expect(stats.bestStreak).toBe(4);
  });

  it('does not depend on the order sessions arrive in', () => {
    const days = [session({ logDate: iso(0) }), session({ logDate: iso(1) })];
    const reversed = [...days].reverse();

    expect(computeStudyStats(reversed).currentStreak).toBe(computeStudyStats(days).currentStreak);
  });
});

describe('computeStudyInsights', () => {
  it('averages focus over only the sessions that rated it', () => {
    // Counting an unrated session as 0 would drag the average down for
    // everybody who does not fill the field in.
    const insights = computeStudyInsights([
      session({ logDate: iso(0), focusRating: 5, startedAt: 1 }),
      session({ logDate: iso(0), focusRating: null, startedAt: 2 }),
      session({ logDate: iso(0), focusRating: 3, startedAt: 3 }),
    ]);

    expect(insights.avgFocusRating).toBe(4);
  });

  it('reports a null focus average when nothing was rated', () => {
    const insights = computeStudyInsights([session({ logDate: iso(0) })]);

    expect(insights.avgFocusRating).toBeNull();
  });

  it('picks the part of day with the most seconds, not the most sessions', () => {
    // Four ten-minute morning sessions should lose to one two-hour evening
    // one: the claim on screen is where you focus best, not where you start.
    const insights = computeStudyInsights([
      session({ logDate: iso(0), startedAt: atHour(8), durationSeconds: 600 }),
      session({ logDate: iso(0), startedAt: atHour(9), durationSeconds: 600 }),
      session({ logDate: iso(0), startedAt: atHour(10), durationSeconds: 600 }),
      session({ logDate: iso(0), startedAt: atHour(11), durationSeconds: 600 }),
      session({ logDate: iso(0), startedAt: atHour(19), durationSeconds: 7200 }),
    ]);

    expect(insights.bestTimeOfDay).toBe('evening');
  });

  it('buckets the hours at the documented boundaries', () => {
    const bucketAt = (hour: number) =>
      computeStudyInsights([session({ logDate: iso(0), startedAt: atHour(hour) })]).bestTimeOfDay;

    expect(bucketAt(5)).toBe('morning');
    expect(bucketAt(11)).toBe('morning');
    expect(bucketAt(12)).toBe('afternoon');
    expect(bucketAt(16)).toBe('afternoon');
    expect(bucketAt(17)).toBe('evening');
    expect(bucketAt(21)).toBe('evening');
    expect(bucketAt(22)).toBe('night');
    expect(bucketAt(4)).toBe('night');
  });

  it('reports null week-over-week when there is no previous week to compare', () => {
    // The division guard. Zero would render as "no change" for somebody in
    // their first week, which is a claim about data that does not exist.
    const insights = computeStudyInsights([session({ logDate: iso(0) })]);

    expect(insights.weekOverWeek).toBeNull();
  });

  it('computes week-over-week as a signed proportion', () => {
    const insights = computeStudyInsights([
      session({ logDate: iso(1), durationSeconds: 1500 }),
      session({ logDate: iso(9), durationSeconds: 1000 }),
    ]);

    expect(insights.weekOverWeek).toBeCloseTo(0.5, 5);
    expect(insights.thisWeekSeconds).toBe(1500);
  });

  it('reports a negative week-over-week when the week got worse', () => {
    const insights = computeStudyInsights([
      session({ logDate: iso(1), durationSeconds: 500 }),
      session({ logDate: iso(9), durationSeconds: 1000 }),
    ]);

    expect(insights.weekOverWeek).toBeCloseTo(-0.5, 5);
  });

  it('handles no sessions at all without dividing by zero', () => {
    const insights = computeStudyInsights([]);

    expect(insights.avgSessionSeconds).toBe(0);
    expect(insights.bestTimeOfDay).toBeNull();
    expect(insights.weekOverWeek).toBeNull();
  });
});

describe('subjectBreakdown', () => {
  const subjects: StudySubject[] = [
    { id: 'maths', name: 'Maths', colorToken: 'blue', createdAt: 0 },
    { id: 'latin', name: 'Latin', colorToken: 'red', createdAt: 0 },
  ];

  it('groups by subject, heaviest first', () => {
    const rows = subjectBreakdown(
      [
        session({ logDate: iso(0), subjectId: 'maths', durationSeconds: 600, startedAt: 1 }),
        session({ logDate: iso(0), subjectId: 'latin', durationSeconds: 1800, startedAt: 2 }),
        session({ logDate: iso(0), subjectId: 'maths', durationSeconds: 600, startedAt: 3 }),
      ],
      subjects,
    );

    expect(rows.map((r) => [r.subject?.name ?? null, r.seconds])).toEqual([
      ['Latin', 1800],
      ['Maths', 1200],
    ]);
  });

  it('keeps unassigned sessions as a null subject rather than dropping them', () => {
    // Time studied without picking a subject is still time studied; dropping it
    // would make the breakdown disagree with the totals above it.
    const rows = subjectBreakdown(
      [session({ logDate: iso(0), subjectId: null, durationSeconds: 900 })],
      subjects,
    );

    expect(rows).toEqual([{ subject: null, seconds: 900 }]);
  });

  it('survives a session pointing at a deleted subject', () => {
    // The row keeps its seconds and loses its name, rather than vanishing.
    const rows = subjectBreakdown(
      [session({ logDate: iso(0), subjectId: 'gone', durationSeconds: 300 })],
      subjects,
    );

    expect(rows).toEqual([{ subject: null, seconds: 300 }]);
  });

  it('honours the since-date window', () => {
    const rows = subjectBreakdown(
      [
        session({ logDate: iso(0), subjectId: 'maths', durationSeconds: 600 }),
        session({ logDate: iso(30), subjectId: 'latin', durationSeconds: 600 }),
      ],
      subjects,
      iso(7),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].subject?.name).toBe('Maths');
  });
});

describe('buildStudyTrend', () => {
  it('zero-fills rest days so the chart has no holes', () => {
    const points = buildStudyTrend([session({ logDate: iso(0), durationSeconds: 1800 })], 7, 1800);

    expect(points).toHaveLength(7);
    expect(points[points.length - 1]).toEqual({ date: iso(0), seconds: 1800, metGoal: true });
    expect(points[0].seconds).toBe(0);
    expect(points[0].metGoal).toBe(false);
  });

  it('runs oldest to newest', () => {
    const points = buildStudyTrend([], 3, 1800);

    expect(points.map((p) => p.date)).toEqual([iso(2), iso(1), iso(0)]);
  });

  it('treats exactly meeting the goal as met', () => {
    const points = buildStudyTrend([session({ logDate: iso(0), durationSeconds: 1800 })], 1, 1800);

    expect(points[0].metGoal).toBe(true);
  });

  it('sums a day before comparing it to the goal', () => {
    // Two half-length sessions make a met goal. Comparing per session would
    // report a missed day to somebody who studied the full hour.
    const points = buildStudyTrend(
      [
        session({ logDate: iso(0), durationSeconds: 900, startedAt: 1 }),
        session({ logDate: iso(0), durationSeconds: 900, startedAt: 2 }),
      ],
      1,
      1800,
    );

    expect(points[0]).toEqual({ date: iso(0), seconds: 1800, metGoal: true });
  });
});

describe('timeOfDayLabelKey', () => {
  it('maps every bucket to a key the caller can translate', () => {
    // A missing entry renders the raw path mid-sentence on the insights screen.
    expect(timeOfDayLabelKey('morning')).toBe('study.morning');
    expect(timeOfDayLabelKey('afternoon')).toBe('study.afternoon');
    expect(timeOfDayLabelKey('evening')).toBe('study.evening');
    expect(timeOfDayLabelKey('night')).toBe('study.night');
  });
});
