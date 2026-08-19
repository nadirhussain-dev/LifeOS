import { buildWeeklyReview, type ReviewMetric } from '@/features/insights/services/weekly-review';
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

/** Fourteen days: indices 0–6 are last week, 7–13 are this week. */
const fortnight = (build: (index: number) => Partial<DailyMetrics>): DailyMetrics[] =>
  Array.from({ length: 14 }, (_, index) =>
    day(`2026-01-${String(index + 1).padStart(2, '0')}`, build(index)),
  );

const find = (metrics: ReviewMetric[], key: string) => metrics.find((m) => m.key === key);

describe('buildWeeklyReview', () => {
  it('reports a metric that rose as moved', () => {
    const review = buildWeeklyReview(fortnight((i) => ({ sleepMinutes: i < 7 ? 360 : 450 })));
    expect(find(review.moved, 'sleepMinutes')).toBeDefined();
    expect(find(review.slipped, 'sleepMinutes')).toBeUndefined();
  });

  it('reports a metric that fell as slipped', () => {
    const review = buildWeeklyReview(fortnight((i) => ({ tasksCompleted: i < 7 ? 8 : 3 })));
    expect(find(review.slipped, 'tasksCompleted')).toBeDefined();
  });

  it('treats a fall in a lower-is-better metric as an improvement', () => {
    // Less spending is a better week. Sorting by raw change would file this
    // under "slipped" and tell someone their thrift was a problem.
    const review = buildWeeklyReview(fortnight((i) => ({ spendCents: i < 7 ? 8000 : 4000 })));
    expect(find(review.moved, 'spendCents')).toBeDefined();
    expect(find(review.moved, 'spendCents')!.improvement).toBeCloseTo(0.5);
  });

  it('treats a rise in stress as a slip', () => {
    const review = buildWeeklyReview(fortnight((i) => ({ stress: i < 7 ? 2 : 4 })));
    expect(find(review.slipped, 'stress')).toBeDefined();
  });

  it('leaves a small wobble alone', () => {
    // Weeks differ by a few percent for no reason. Announcing that as news
    // trains people to ignore the screen.
    const review = buildWeeklyReview(fortnight((i) => ({ sleepMinutes: i < 7 ? 420 : 434 })));
    expect(find(review.moved, 'sleepMinutes')).toBeUndefined();
    expect(find(review.steady, 'sleepMinutes')).toBeDefined();
  });

  it('averages only the days that carry a metric', () => {
    // Two nights unlogged out of seven. Counting those as zero hours would
    // report a collapse in sleep to somebody who simply forgot twice.
    const review = buildWeeklyReview(
      fortnight((i) => ({ sleepMinutes: i < 7 ? 420 : i >= 12 ? null : 420 })),
    );
    expect(find(review.steady, 'sleepMinutes')).toBeDefined();
    expect(find(review.steady, 'sleepMinutes')!.current).toBe(420);
  });

  it('does not compare against a week with no data', () => {
    const review = buildWeeklyReview(fortnight((i) => (i < 7 ? {} : { sleepMinutes: 450 })));
    expect(find(review.moved, 'sleepMinutes')).toBeUndefined();
    expect(find(review.slipped, 'sleepMinutes')).toBeUndefined();
  });

  it('does not express a change from zero as a percentage', () => {
    // Going from no spending at all to some spending is not an infinite rise;
    // it is a week that cannot be put as a percentage.
    const review = buildWeeklyReview(fortnight((i) => ({ spendCents: i < 7 ? 0 : 5000 })));
    expect(find(review.moved, 'spendCents')).toBeUndefined();
    expect(find(review.slipped, 'spendCents')).toBeUndefined();
  });

  it('counts the days of the current week that have anything in them', () => {
    const review = buildWeeklyReview(fortnight((i) => (i >= 7 && i < 11 ? { waterMl: 500 } : {})));
    expect(review.loggedDays).toBe(4);
  });

  it('ranks the biggest change first', () => {
    const review = buildWeeklyReview(
      fortnight((i) => ({
        sleepMinutes: i < 7 ? 400 : 460, // +15%
        tasksCompleted: i < 7 ? 2 : 8, // +300%
      })),
    );
    expect(review.moved[0].key).toBe('tasksCompleted');
  });

  it('works on less than a fortnight rather than throwing', () => {
    // The honest behaviour for somebody eight days into using the app.
    const short = Array.from({ length: 8 }, (_, i) =>
      day(`2026-02-${String(i + 1).padStart(2, '0')}`, { waterMl: 1000 }),
    );
    expect(() => buildWeeklyReview(short)).not.toThrow();
    expect(buildWeeklyReview(short).loggedDays).toBe(7);
  });

  it('does not care what order the days arrive in', () => {
    const shuffled = [...fortnight((i) => ({ sleepMinutes: i < 7 ? 360 : 450 }))].reverse();
    expect(find(buildWeeklyReview(shuffled).moved, 'sleepMinutes')).toBeDefined();
  });
});
