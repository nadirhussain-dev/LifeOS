import type { DailyMetrics, MetricKey } from '@/features/insights/types/insights.types';
import { mean } from '@/features/insights/services/statistics';

/**
 * The week, compared with the one before it.
 *
 * This is the ritual the app is for: one screen, once a week, saying what moved
 * and what slipped. No single-purpose app can assemble it, because half the
 * numbers live in a competitor's database — which is exactly why it is worth
 * more than any individual module's depth.
 *
 * Pure, and tested, because every figure on that screen is a claim about
 * somebody's week and the arithmetic behind it has to be boring.
 */

/** Whether a rise in a metric is a good week or a bad one. */
export type MetricPolarity = 'higher_is_better' | 'lower_is_better';

export type ReviewMetric = {
  key: MetricKey;
  polarity: MetricPolarity;
  /** Mean over the days that actually carry the metric. Null when none do. */
  current: number | null;
  previous: number | null;
  /** Signed change as a fraction of the previous mean, or null when there is
   *  no previous mean to be a fraction of. */
  relativeChange: number | null;
  /** `relativeChange` re-signed so positive always means "better week". */
  improvement: number | null;
};

export type WeeklyReview = {
  /** Days in the current window that have anything logged at all. */
  loggedDays: number;
  moved: ReviewMetric[];
  slipped: ReviewMetric[];
  /** Metrics with data in both weeks that changed too little to mention. */
  steady: ReviewMetric[];
};

/**
 * The metrics the review reports on, and which direction is good.
 *
 * A deliberately short list. A review that reports nineteen numbers is a
 * dashboard, and the point of this screen is that it says a few true things
 * somebody will act on.
 */
export const REVIEW_METRICS: { key: MetricKey; polarity: MetricPolarity }[] = [
  { key: 'sleepMinutes', polarity: 'higher_is_better' },
  { key: 'habitsCompleted', polarity: 'higher_is_better' },
  { key: 'tasksCompleted', polarity: 'higher_is_better' },
  { key: 'moodScore', polarity: 'higher_is_better' },
  { key: 'energy', polarity: 'higher_is_better' },
  { key: 'waterMl', polarity: 'higher_is_better' },
  { key: 'studySeconds', polarity: 'higher_is_better' },
  { key: 'stress', polarity: 'lower_is_better' },
  { key: 'spendCents', polarity: 'lower_is_better' },
];

/**
 * How much a metric has to move before the review mentions it.
 *
 * Weeks differ by a few percent for no reason at all. A review that announced
 * every wobble as news would train people to ignore it, which costs more than
 * missing a small real change.
 */
const NOTEWORTHY_CHANGE = 0.1;

function meanOf(days: DailyMetrics[], key: MetricKey): number | null {
  // Only days that carry the metric. Treating a missing sleep session as zero
  // hours would report a catastrophic week to anyone who forgot to log twice.
  const values = days.map((day) => day[key]).filter((value): value is number => value != null);
  return values.length === 0 ? null : mean(values);
}

function hasAnything(day: DailyMetrics): boolean {
  return (
    day.sleepMinutes != null ||
    day.studySeconds > 0 ||
    day.habitsCompleted > 0 ||
    day.spendCents > 0 ||
    day.mood != null ||
    day.tasksCompleted > 0 ||
    day.waterMl > 0
  );
}

/**
 * Splits a run of days into "this week" and "the week before", and compares them.
 *
 * `days` is expected oldest-first and at least fourteen long; the last seven are
 * the current week. Shorter input still works and simply has less to compare
 * against, which is the honest behaviour for someone two weeks into using the
 * app.
 */
export function buildWeeklyReview(days: DailyMetrics[]): WeeklyReview {
  const ordered = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const current = ordered.slice(-7);
  const previous = ordered.slice(-14, -7);

  const metrics: ReviewMetric[] = REVIEW_METRICS.map(({ key, polarity }) => {
    const currentMean = meanOf(current, key);
    const previousMean = meanOf(previous, key);

    // A change needs both halves, and a previous mean of zero gives nothing to
    // be a percentage of — going from no spending to any spending is not "an
    // infinite rise", it is a week that cannot be expressed as one.
    const relativeChange =
      currentMean == null || previousMean == null || previousMean === 0
        ? null
        : (currentMean - previousMean) / Math.abs(previousMean);

    return {
      key,
      polarity,
      current: currentMean,
      previous: previousMean,
      relativeChange,
      improvement:
        relativeChange == null
          ? null
          : polarity === 'higher_is_better'
            ? relativeChange
            : -relativeChange,
    };
  });

  const comparable = metrics.filter((metric) => metric.improvement != null);
  const byMagnitude = (a: ReviewMetric, b: ReviewMetric) =>
    Math.abs(b.improvement!) - Math.abs(a.improvement!);

  return {
    loggedDays: current.filter(hasAnything).length,
    moved: comparable
      .filter((metric) => metric.improvement! >= NOTEWORTHY_CHANGE)
      .sort(byMagnitude),
    slipped: comparable
      .filter((metric) => metric.improvement! <= -NOTEWORTHY_CHANGE)
      .sort(byMagnitude),
    steady: comparable.filter((metric) => Math.abs(metric.improvement!) < NOTEWORTHY_CHANGE),
  };
}
