import {
  CORRELATION_SPECS,
  type CorrelationSpec,
} from '@/features/insights/config/correlation-specs';
import {
  benjaminiHochberg,
  mean,
  tTestPValue,
  welchT,
} from '@/features/insights/services/statistics';
import type {
  DailyMetrics,
  InsightCandidate,
  InsightsResult,
} from '@/features/insights/types/insights.types';

/** Days with something in them. Below this the screen says so rather than
 *  producing findings from a fortnight of blanks. */
const MIN_LOGGED_DAYS = 7;

/** How many findings the screen will show at once, headline included. Not a
 *  rendering limit — a list of twelve "patterns" reads as a horoscope however
 *  well each one was tested. */
const MAX_FINDINGS = 4;

/** Proportion of shown findings we accept being false. See the
 *  Benjamini–Hochberg note in statistics.ts for why this is not 0.05. */
const FALSE_DISCOVERY_RATE = 0.1;

/**
 * Pairs each day's driver value with the outcome `lagDays` later.
 *
 * Both sides must be present. A null is missing information, not a zero, and
 * pairing "no sleep session logged" with a good mood is how an engine ends up
 * reporting that not tracking your sleep makes you happier.
 */
function pairedSamples(
  daily: DailyMetrics[],
  spec: CorrelationSpec,
): { driver: number; outcome: number }[] {
  const byDate = new Map(daily.map((day) => [day.date, day]));
  const dates = daily.map((day) => day.date).sort();
  const samples: { driver: number; outcome: number }[] = [];

  dates.forEach((date, index) => {
    const driverDay = byDate.get(date);
    const outcomeDate = dates[index + spec.lagDays];
    const outcomeDay = outcomeDate ? byDate.get(outcomeDate) : undefined;
    if (!driverDay || !outcomeDay) return;

    const driver = driverDay[spec.driver];
    const outcome = outcomeDay[spec.outcome];
    if (driver == null || outcome == null) return;
    samples.push({ driver, outcome });
  });

  return samples;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

/**
 * Evaluates one spec, returning a candidate only if it clears every guard.
 *
 * The guards are applied in increasing order of cost, which is also increasing
 * order of how easy they are to argue with: enough data, then a difference big
 * enough to be worth a sentence, then a difference unlikely to be chance. All
 * three have to hold. Dropping any one of them is how this becomes a feature
 * that tells people confident stories about noise.
 */
function evaluate(daily: DailyMetrics[], spec: CorrelationSpec): InsightCandidate | null {
  const samples = pairedSamples(daily, spec);
  if (samples.length < spec.minGroup * 2) return null;

  const cut =
    spec.split.kind === 'threshold'
      ? spec.split.at
      : median(samples.map((sample) => sample.driver));

  const high = samples.filter((sample) => sample.driver >= cut).map((s) => s.outcome);
  const low = samples.filter((sample) => sample.driver < cut).map((s) => s.outcome);
  if (high.length < spec.minGroup || low.length < spec.minGroup) return null;

  const highMean = mean(high);
  const lowMean = mean(low);

  // Signed so that a positive difference always means "the spec's expectation
  // held", whichever direction it expected.
  const observed = spec.expect === 'higher' ? highMean - lowMean : lowMean - highMean;
  if (observed <= 0) return null;

  const base = Math.min(highMean, lowMean);
  // A relative effect needs something to be relative to. With a zero baseline —
  // no spending at all in the quieter group, say — any difference is infinite,
  // which is not a finding, it is a division by zero wearing a hat.
  if (base <= 0) return null;

  const relativeEffect = observed / base;
  if (relativeEffect < spec.effectFloor) return null;

  const t = welchT(high, low);
  if (!t) return null;
  const pValue = tTestPValue(t.t, t.df);

  return {
    key: spec.key,
    modules: spec.modules,
    // Effect size, damped by how much evidence stands behind it, so a big
    // difference across eight days does not outrank a slightly smaller one
    // across forty.
    strength: Math.min(1, relativeEffect) * Math.min(1, samples.length / (spec.minGroup * 5)),
    params: { percent: Math.round(relativeEffect * 100) },
    sampleSize: samples.length,
    pValue,
    lagDays: spec.lagDays,
  };
}

/**
 * Every pattern the app can currently see, filtered down to the ones worth
 * saying out loud.
 *
 * Deliberately not machine learning. At the volume one person logs — dozens to
 * a few hundred days — a two-group comparison with a real significance test is
 * both more honest and explicable in a sentence, which matters because every
 * finding here is shown to someone as a claim about their own life.
 *
 * The multiple-comparison correction is the part that would be easiest to skip
 * and most damaging to. Testing fourteen pairs at p<0.05 means an evens chance
 * of at least one false positive in a person with no patterns at all, and that
 * person is precisely who would screenshot it.
 */
export function computeInsights(daily: DailyMetrics[]): InsightsResult {
  const loggedDays = daily.filter(
    (day) =>
      day.sleepMinutes != null ||
      day.studySeconds > 0 ||
      day.habitsScheduled > 0 ||
      day.spendCents > 0 ||
      day.mood != null ||
      day.tasksCompleted > 0 ||
      day.waterMl > 0,
  );

  if (loggedDays.length < MIN_LOGGED_DAYS) {
    return {
      status: 'insufficient_data',
      headline: null,
      patterns: [],
      pairsTested: CORRELATION_SPECS.length,
    };
  }

  const evaluated = CORRELATION_SPECS.map((spec) => evaluate(daily, spec)).filter(
    (candidate): candidate is InsightCandidate => candidate !== null,
  );

  const survives = benjaminiHochberg(
    evaluated.map((candidate) => candidate.pValue),
    FALSE_DISCOVERY_RATE,
  );
  const kept = evaluated
    .filter((_, index) => survives[index])
    .sort((a, b) => b.strength - a.strength);

  if (kept.length === 0) {
    return {
      status: 'no_pattern_yet',
      headline: null,
      patterns: [],
      pairsTested: CORRELATION_SPECS.length,
    };
  }

  return {
    status: 'ready',
    headline: kept[0],
    patterns: kept.slice(1, MAX_FINDINGS),
    pairsTested: CORRELATION_SPECS.length,
  };
}
