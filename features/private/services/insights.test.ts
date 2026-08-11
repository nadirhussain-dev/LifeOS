import {
  cycleLengthTrend,
  intimacyMoodTrend,
  recoverySummary,
} from '@/features/private/services/insights';
import type { Period } from '@/features/private/services/cycle-math';
import type { IntimacyEntry } from '@/features/private/services/intimacy';
import type { RecoveryEntry } from '@/features/private/services/recovery-math';

const period = (start: string, end: string, days: number): Period => ({ start, end, days });

describe('cycleLengthTrend', () => {
  it('returns the gaps between consecutive period starts, oldest first', () => {
    const periods = [
      period('2026-04-02', '2026-04-05', 4),
      period('2026-03-03', '2026-03-06', 4),
      period('2026-02-01', '2026-02-04', 4),
    ];
    expect(cycleLengthTrend(periods)).toEqual([30, 30]);
  });

  it('drops implausible gaps, same as averageCycleLength', () => {
    const periods = [
      period('2027-01-01', '2027-01-04', 4),
      // A mistyped year: an ~360-day gap should be filtered out.
      period('2026-01-05', '2026-01-08', 4),
      period('2025-12-06', '2025-12-09', 4),
    ];
    expect(cycleLengthTrend(periods)).toEqual([30]);
  });

  it('caps to the most recent `max` entries', () => {
    const periods = Array.from({ length: 5 }, (_, i) => {
      const day = 1 + i * 28;
      const d = new Date(2026, 0, day);
      const end = new Date(2026, 0, day + 3);
      const fmt = (x: Date) =>
        `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
      return period(fmt(d), fmt(end), 4);
    }).reverse();
    expect(cycleLengthTrend(periods, 2)).toHaveLength(2);
  });
});

const recoveryEntry = (
  date: string,
  outcome: RecoveryEntry['outcome'],
  target: RecoveryEntry['target'] = 'porn',
): RecoveryEntry => ({
  id: date + outcome,
  createdAt: 0,
  updatedAt: 0,
  date,
  target,
  outcome,
  intensity: 3,
  triggers: [],
  note: '',
});

describe('recoverySummary', () => {
  it('is empty with no entries', () => {
    expect(recoverySummary([])).toEqual([]);
  });

  it('one row per target actually logged, with resisted/relapsed counts', () => {
    const rows = recoverySummary([
      recoveryEntry('2026-01-01', 'resisted', 'porn'),
      recoveryEntry('2026-01-02', 'relapsed', 'porn'),
      recoveryEntry('2026-01-03', 'resisted', 'smoking'),
    ]);
    expect(rows).toHaveLength(2);
    const porn = rows.find((r) => r.target === 'porn');
    expect(porn?.resisted).toBe(1);
    expect(porn?.relapsed).toBe(1);
  });
});

const intimacyEntry = (date: string, mood: number | null): IntimacyEntry => ({
  id: date,
  createdAt: 0,
  updatedAt: 0,
  date,
  mood,
  tags: [],
  note: '',
});

describe('intimacyMoodTrend', () => {
  it('reports nulls with no mood entries', () => {
    expect(intimacyMoodTrend([])).toEqual({
      recentAverage: null,
      priorAverage: null,
      improving: null,
    });
  });

  it('is null on `improving` without a full prior window', () => {
    const trend = intimacyMoodTrend(
      [intimacyEntry('2026-01-01', 4), intimacyEntry('2026-01-02', 5)],
      5,
    );
    expect(trend.priorAverage).toBeNull();
    expect(trend.improving).toBeNull();
  });

  it('compares the two most recent windows and says which way it moved', () => {
    const entries = [
      intimacyEntry('2026-01-01', 2),
      intimacyEntry('2026-01-02', 2),
      intimacyEntry('2026-01-03', 4),
      intimacyEntry('2026-01-04', 4),
    ];
    const trend = intimacyMoodTrend(entries, 2);
    expect(trend.priorAverage).toBe(2);
    expect(trend.recentAverage).toBe(4);
    expect(trend.improving).toBe(true);
  });

  it('ignores symptom-only entries with no mood recorded', () => {
    const trend = intimacyMoodTrend(
      [intimacyEntry('2026-01-01', null), intimacyEntry('2026-01-02', 3)],
      5,
    );
    expect(trend.recentAverage).toBe(3);
  });
});
