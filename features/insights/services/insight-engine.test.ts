import { computeInsights } from '@/features/insights/services/insight-engine';
import type { DailyMetrics } from '@/features/insights/types/insights.types';

const day = (date: string, over: Partial<DailyMetrics> = {}): DailyMetrics => ({
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
  ...over,
});

/**
 * Deterministic PRNG (mulberry32).
 *
 * An earlier version of the noise fixture below used `(i * 9301 + n * 49297) %
 * 233280`, which is linear in the day index — so every metric derived from it
 * was a straight line against every other one, and the engine correctly found
 * strong patterns in what the test called "noise". A real generator is the only
 * way to assert the absence of structure.
 */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `count` consecutive days from 2026-01-01, built by index. */
const series = (count: number, build: (index: number) => Partial<DailyMetrics>): DailyMetrics[] =>
  Array.from({ length: count }, (_, index) => {
    const date = new Date(2026, 0, 1 + index);
    const key = `2026-01-${String(date.getDate()).padStart(2, '0')}`;
    return day(key, build(index));
  });

describe('computeInsights', () => {
  it('says so when there is not enough logged', () => {
    const result = computeInsights(series(5, () => ({ sleepMinutes: 400 })));
    expect(result.status).toBe('insufficient_data');
    expect(result.headline).toBeNull();
  });

  it('counts a day with any module logged as logged', () => {
    // Water alone is enough to make a day count — the gate is "did you use the
    // app", not "did you use sleep tracking".
    const result = computeInsights(series(10, () => ({ waterMl: 500 })));
    expect(result.status).not.toBe('insufficient_data');
  });

  it('reports pairs tested even when it finds nothing', () => {
    // "We checked 14 pairs and 2 stood out" is a more honest claim than "we
    // found 2 patterns", so the count is always available to the screen.
    const result = computeInsights(series(20, () => ({ waterMl: 500 })));
    expect(result.pairsTested).toBeGreaterThan(10);
  });

  describe('finding a real pattern', () => {
    // A strong, consistent effect: long sleep pairs with high focus, short with
    // low, across forty days and with enough spread to be testable.
    const strong = series(40, (i) => {
      const slept = i % 2 === 0;
      return {
        sleepMinutes: slept ? 470 + (i % 5) : 350 + (i % 5),
        focusRating: slept ? 4.6 - (i % 3) * 0.1 : 2.4 + (i % 3) * 0.1,
      };
    });

    it('finds it', () => {
      const result = computeInsights(strong);
      expect(result.status).toBe('ready');
      expect(result.headline?.key).toBe('sleepFocus');
    });

    it('carries the evidence, not just the claim', () => {
      const headline = computeInsights(strong).headline!;
      expect(headline.sampleSize).toBeGreaterThan(20);
      expect(headline.pValue).toBeLessThan(0.01);
      expect(headline.params.percent).toBeGreaterThan(50);
    });
  });

  describe('refusing what it should refuse', () => {
    it('finds nothing in noise', () => {
      // The case that decides whether this feature is trustworthy. Pseudo-random
      // but deterministic, so a regression here is reproducible.
      const random = mulberry32(20260818);
      const noise = series(60, () => ({
        sleepMinutes: 300 + Math.floor(random() * 240),
        focusRating: 1 + random() * 4,
        moodScore: 1 + random() * 4,
        spendCents: 1000 + Math.floor(random() * 8000),
        habitsCompleted: Math.floor(random() * 6),
        habitsScheduled: 6,
        energy: 1 + random() * 4,
        stress: 1 + random() * 4,
        waterMl: 500 + Math.floor(random() * 3000),
        studySeconds: Math.floor(random() * 7200),
        tasksCompleted: Math.floor(random() * 8),
        journalWords: Math.floor(random() * 400),
        bedtimeOffsetMinutes: 540 + Math.floor(random() * 240),
        fellAsleepMinutes: 5 + Math.floor(random() * 50),
      }));
      expect(computeInsights(noise).status).toBe('no_pattern_yet');
    });

    it('ignores a difference too small to be worth a sentence', () => {
      // Statistically detectable at this sample size, and still a 2% change in
      // focus. Significance and importance are different questions.
      const tiny = series(60, (i) => {
        const slept = i % 2 === 0;
        return {
          sleepMinutes: slept ? 480 : 360,
          focusRating: slept ? 3.02 + (i % 4) * 0.001 : 3.0 + (i % 4) * 0.001,
        };
      });
      expect(computeInsights(tiny).status).toBe('no_pattern_yet');
    });

    it('ignores an effect in the direction the spec did not expect', () => {
      // More sleep, consistently *worse* focus. Reporting this as "sleep helps
      // your focus" with the sign quietly dropped is the worst available bug.
      const inverted = series(40, (i) => {
        const slept = i % 2 === 0;
        return {
          sleepMinutes: slept ? 480 + (i % 5) : 360 + (i % 5),
          focusRating: slept ? 2.4 + (i % 3) * 0.1 : 4.6 - (i % 3) * 0.1,
        };
      });
      const result = computeInsights(inverted);
      expect(result.patterns.map((p) => p.key)).not.toContain('sleepFocus');
      expect(result.headline?.key).not.toBe('sleepFocus');
    });

    it('does not pair a missing day with a present one', () => {
      // Only ten days carry both metrics; the rest have focus and no sleep. If
      // nulls were read as zeros, those thirty days would form a huge
      // "short sleep" group and manufacture an effect.
      const sparse = series(40, (i) => ({
        sleepMinutes: i < 10 ? 480 : null,
        focusRating: 4,
        waterMl: 500,
      }));
      const result = computeInsights(sparse);
      expect(result.headline?.key).not.toBe('sleepFocus');
    });

    it('does not divide by a zero baseline', () => {
      // No spending at all in the quieter group makes any difference infinite,
      // which is not a finding.
      const zeroBase = series(40, (i) => ({
        moodScore: i % 2 === 0 ? 5 : 1,
        spendCents: 0,
      }));
      expect(() => computeInsights(zeroBase)).not.toThrow();
      expect(computeInsights(zeroBase).patterns.map((p) => p.key)).not.toContain('moodSpending');
    });
  });

  it('shows at most four findings', () => {
    // Every metric strongly separated, with real within-group spread — a group
    // of identical values has no variance, and Welch's t has nothing to work
    // with, so a fixture without jitter would test the wrong thing.
    const random = mulberry32(7);
    const everything = series(60, (i) => {
      const good = i % 2 === 0;
      const jitter = (spread: number) => (random() - 0.5) * spread;
      return {
        sleepMinutes: (good ? 480 : 330) + jitter(30),
        focusRating: (good ? 4.5 : 2.0) + jitter(0.6),
        moodScore: (good ? 4.6 : 1.6) + jitter(0.6),
        habitsCompleted: (good ? 6 : 1) + jitter(1),
        habitsScheduled: 6,
        energy: (good ? 4.6 : 1.6) + jitter(0.6),
        tasksCompleted: (good ? 8 : 1) + jitter(2),
        waterMl: (good ? 2500 : 500) + jitter(300),
        studySeconds: (good ? 7200 : 600) + jitter(600),
        journalWords: (good ? 400 : 20) + jitter(60),
        fellAsleepMinutes: (good ? 8 : 40) + jitter(6),
      };
    });
    const result = computeInsights(everything);
    expect(result.status).toBe('ready');
    expect(1 + result.patterns.length).toBeLessThanOrEqual(4);
  });
});
