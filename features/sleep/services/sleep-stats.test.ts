import {
  buildTrend,
  computeSleepStats,
  durationBetween,
  formatClock,
  formatDuration,
  minutesOfDay,
} from '@/features/sleep/services/sleep-stats';
import type { SleepSession } from '@/features/sleep/types/sleep.types';

/**
 * The numbers on the Sleep screen.
 *
 * The load-bearing idea in this file is that clock times are *angular*: 23:50
 * and 00:10 are twenty minutes apart, not twenty-three hours and forty. An
 * arithmetic mean of those two gives noon — the precise opposite of the truth,
 * and a plausible enough number that nobody would question it. `circularMean`
 * is the right treatment and had no test; most of what follows pins that.
 */

/** A night, with only the fields the statistics actually read set explicitly. */
function night(overrides: Partial<SleepSession> & { logDate: string }): SleepSession {
  return {
    id: `s-${overrides.logDate}`,
    bedtime: Date.UTC(2026, 0, 1, 22, 0),
    wakeTime: Date.UTC(2026, 0, 2, 6, 0),
    durationMinutes: 480,
    fellAsleepMinutes: null,
    quality: null,
    note: null,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

/** Local-time epoch ms for a clock time, since `minutesOfDay` reads local. */
const at = (hour: number, minute = 0) => new Date(2026, 0, 5, hour, minute).getTime();

describe('formatClock', () => {
  it('renders the 12-hour boundaries the way a clock does', () => {
    // Midnight and noon are where a naive `h % 12` prints "0:00".
    expect(formatClock(0)).toBe('12:00 AM');
    expect(formatClock(720)).toBe('12:00 PM');
    expect(formatClock(1439)).toBe('11:59 PM');
    expect(formatClock(60)).toBe('1:00 AM');
    expect(formatClock(780)).toBe('1:00 PM');
  });

  it('wraps values outside a single day in both directions', () => {
    // `circularMean` can hand back something a hair below 0 or above 1440;
    // either would render as a negative or 25-hour clock time.
    expect(formatClock(1440)).toBe('12:00 AM');
    expect(formatClock(1500)).toBe('1:00 AM');
    expect(formatClock(-10)).toBe('11:50 PM');
  });
});

describe('formatDuration', () => {
  it('drops the empty half of the pair', () => {
    expect(formatDuration(0)).toBe('0m');
    expect(formatDuration(45)).toBe('45m');
    expect(formatDuration(60)).toBe('1h');
    expect(formatDuration(465)).toBe('7h 45m');
  });

  it('never renders a negative duration', () => {
    expect(formatDuration(-30)).toBe('0m');
  });
});

describe('minutesOfDay', () => {
  it('counts minutes past local midnight', () => {
    expect(minutesOfDay(at(0, 0))).toBe(0);
    expect(minutesOfDay(at(22, 30))).toBe(22 * 60 + 30);
    expect(minutesOfDay(at(23, 59))).toBe(1439);
  });
});

describe('durationBetween', () => {
  it('measures a night that crosses midnight', () => {
    // Callers roll the wake timestamp onto the next day, so this is ordinary
    // subtraction — but it is the value the whole screen averages.
    const bed = new Date(2026, 0, 5, 23, 0).getTime();
    const wake = new Date(2026, 0, 6, 7, 30).getTime();

    expect(durationBetween(bed, wake)).toBe(510);
  });

  it('clamps rather than returning a negative night', () => {
    // A mis-entered wake time earlier than bedtime would otherwise average in
    // as a negative and drag the mean below zero.
    const bed = new Date(2026, 0, 5, 23, 0).getTime();
    const wake = new Date(2026, 0, 5, 22, 0).getTime();

    expect(durationBetween(bed, wake)).toBe(0);
  });
});

describe('average bedtime across midnight', () => {
  it('averages 23:50 and 00:10 to midnight, not to noon', () => {
    // The headline case. An arithmetic mean of 1430 and 10 is 720 — noon —
    // which is both wrong and completely believable on screen.
    const stats = computeSleepStats(
      [
        night({ logDate: '2026-01-05', bedtime: at(23, 50) }),
        night({ logDate: '2026-01-06', bedtime: at(0, 10) }),
      ],
      420,
    );

    const mean = stats.avgBedtimeMinutes ?? -1;
    const distanceFromMidnight = Math.min(mean, 1440 - mean);
    expect(distanceFromMidnight).toBeLessThan(1);
  });

  it('still averages ordinary same-side times the obvious way', () => {
    // The circular treatment must not distort the common case.
    const stats = computeSleepStats(
      [
        night({ logDate: '2026-01-05', bedtime: at(22, 0) }),
        night({ logDate: '2026-01-06', bedtime: at(23, 0) }),
      ],
      420,
    );

    expect(stats.avgBedtimeMinutes).toBeCloseTo(22 * 60 + 30, 0);
  });

  it('scores consistency 1 for identical bedtimes and near 0 for opposite ones', () => {
    const identical = computeSleepStats(
      [
        night({ logDate: '2026-01-05', bedtime: at(23, 0) }),
        night({ logDate: '2026-01-06', bedtime: at(23, 0) }),
      ],
      420,
    );
    expect(identical.consistency).toBeCloseTo(1, 5);

    // Twelve hours apart cancel exactly: the resultant vector is zero length.
    const opposite = computeSleepStats(
      [
        night({ logDate: '2026-01-05', bedtime: at(0, 0) }),
        night({ logDate: '2026-01-06', bedtime: at(12, 0) }),
      ],
      420,
    );
    expect(opposite.consistency).toBeCloseTo(0, 5);
  });
});

describe('computeSleepStats', () => {
  it('returns a complete zeroed shape for no nights', () => {
    // Every field is read by the screen; a missing key renders as NaN or blank
    // rather than as "nothing tracked yet".
    const stats = computeSleepStats([], 420);

    expect(stats).toEqual({
      nightsTracked: 0,
      avgDurationMinutes: 0,
      currentStreak: 0,
      bestStreak: 0,
      consistency: 0,
      goalMetCount: 0,
      avgBedtimeMinutes: null,
      avgWakeMinutes: null,
      avgFellAsleepMinutes: null,
    });
  });

  it('counts only the nights that met the goal', () => {
    const stats = computeSleepStats(
      [
        night({ logDate: '2026-01-05', durationMinutes: 400 }),
        night({ logDate: '2026-01-06', durationMinutes: 420 }),
        night({ logDate: '2026-01-07', durationMinutes: 500 }),
      ],
      420,
    );

    // Exactly at the goal counts as met — the boundary is inclusive.
    expect(stats.goalMetCount).toBe(2);
    expect(stats.nightsTracked).toBe(3);
    expect(stats.avgDurationMinutes).toBeCloseTo(440, 5);
  });

  it('averages sleep latency over only the nights that recorded it', () => {
    // Treating an unrecorded latency as 0 would report everybody falling asleep
    // faster than they do, and the more nights they skip the better it looks.
    const stats = computeSleepStats(
      [
        night({ logDate: '2026-01-05', fellAsleepMinutes: 20 }),
        night({ logDate: '2026-01-06', fellAsleepMinutes: null }),
        night({ logDate: '2026-01-07', fellAsleepMinutes: 40 }),
      ],
      420,
    );

    expect(stats.avgFellAsleepMinutes).toBe(30);
  });

  it('reports null latency when no night recorded one', () => {
    const stats = computeSleepStats([night({ logDate: '2026-01-05' })], 420);

    expect(stats.avgFellAsleepMinutes).toBeNull();
  });
});

describe('streaks', () => {
  const met = (logDate: string) => night({ logDate, durationMinutes: 480 });
  const missed = (logDate: string) => night({ logDate, durationMinutes: 300 });

  it('counts consecutive nights that met the goal', () => {
    const stats = computeSleepStats([met('2026-01-05'), met('2026-01-06'), met('2026-01-07')], 420);

    expect(stats.currentStreak).toBe(3);
    expect(stats.bestStreak).toBe(3);
  });

  it('breaks the run on an untracked gap, not just on a miss', () => {
    // 6 January is absent entirely. A streak that ignores gaps rewards not
    // logging, which is the opposite of what the number is for.
    const stats = computeSleepStats([met('2026-01-05'), met('2026-01-07')], 420);

    expect(stats.currentStreak).toBe(1);
    expect(stats.bestStreak).toBe(1);
  });

  it('keeps a best streak that the current run has already lost', () => {
    // The bug this shape is prone to: capping best at current, so a long past
    // run disappears the first night somebody misses.
    const stats = computeSleepStats(
      [
        met('2026-01-01'),
        met('2026-01-02'),
        met('2026-01-03'),
        missed('2026-01-04'),
        met('2026-01-05'),
      ],
      420,
    );

    expect(stats.currentStreak).toBe(1);
    expect(stats.bestStreak).toBe(3);
  });

  it('reports a current streak of 0 when the most recent night missed', () => {
    const stats = computeSleepStats([met('2026-01-05'), missed('2026-01-06')], 420);

    expect(stats.currentStreak).toBe(0);
    expect(stats.bestStreak).toBe(1);
  });

  it('does not depend on the order the nights arrive in', () => {
    // Repositories return whatever the query ordered by; the statistics must
    // not quietly depend on that.
    const nights = [met('2026-01-05'), met('2026-01-06'), met('2026-01-07')];
    const shuffled = [nights[2], nights[0], nights[1]];

    expect(computeSleepStats(shuffled, 420).currentStreak).toBe(
      computeSleepStats(nights, 420).currentStreak,
    );
  });
});

describe('buildTrend', () => {
  it('returns tracked nights oldest first', () => {
    const today = new Date();
    const iso = (daysAgo: number) => {
      const d = new Date(today);
      d.setDate(d.getDate() - daysAgo);
      return d.toISOString().slice(0, 10);
    };

    const points = buildTrend(
      [
        night({ logDate: iso(1), durationMinutes: 400 }),
        night({ logDate: iso(3), durationMinutes: 480 }),
        night({ logDate: iso(2), durationMinutes: 500 }),
      ],
      420,
      7,
    );

    expect(points.map((p) => p.date)).toEqual([iso(3), iso(2), iso(1)]);
    expect(points.map((p) => p.metGoal)).toEqual([true, true, false]);
  });

  it('excludes nights older than the window', () => {
    const today = new Date();
    const iso = (daysAgo: number) => {
      const d = new Date(today);
      d.setDate(d.getDate() - daysAgo);
      return d.toISOString().slice(0, 10);
    };

    const points = buildTrend([night({ logDate: iso(1) }), night({ logDate: iso(30) })], 420, 7);

    expect(points).toHaveLength(1);
    expect(points[0].date).toBe(iso(1));
  });
});
