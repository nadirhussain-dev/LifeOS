import type {
  DailyMetrics,
  InsightCandidate,
  InsightsResult,
} from '@/features/insights/types/insights.types';

const SEVEN_HOURS_MINUTES = 420;
const MIN_GROUP_SIZE = 3;
const MIN_LOW_MOOD_DAYS = 2;
const MIN_LOGGED_DAYS = 7;

function average(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Caps a candidate's strength by how much data actually backs it, so ten
 *  qualifying days count for more than the three-day minimum. */
function confidence(sampleSize: number, target: number): number {
  return Math.min(1, sampleSize / target);
}

/** Nights with 7+ hours of sleep vs. shorter nights, compared on the focus
 *  rating of study sessions logged that same day. */
function sleepFocusCandidate(daily: DailyMetrics[]): InsightCandidate | null {
  const relevant = daily.filter((d) => d.sleepMinutes != null && d.focusRating != null);
  const high = relevant.filter((d) => (d.sleepMinutes ?? 0) >= SEVEN_HOURS_MINUTES);
  const low = relevant.filter((d) => (d.sleepMinutes ?? 0) < SEVEN_HOURS_MINUTES);
  if (high.length < MIN_GROUP_SIZE || low.length < MIN_GROUP_SIZE) return null;

  const highAvg = average(high.map((d) => d.focusRating as number));
  const lowAvg = average(low.map((d) => d.focusRating as number));
  if (lowAvg <= 0 || highAvg <= lowAvg) return null;

  const percent = (highAvg - lowAvg) / lowAvg;
  if (percent < 0.08) return null;

  return {
    key: 'sleepFocus',
    modules: ['sleep', 'study'],
    strength: Math.min(1, percent) * confidence(high.length + low.length, 16),
    params: { percent: Math.round(percent * 100) },
  };
}

/** Days most of that day's scheduled habits got done vs. days most didn't,
 *  compared on how long it took to fall asleep that night. */
function habitsSleepCandidate(daily: DailyMetrics[]): InsightCandidate | null {
  const relevant = daily.filter((d) => d.habitsScheduled > 0 && d.fellAsleepMinutes != null);
  const completed = relevant.filter((d) => d.habitsCompleted / d.habitsScheduled >= 0.8);
  const rest = relevant.filter((d) => d.habitsCompleted / d.habitsScheduled < 0.8);
  if (completed.length < MIN_GROUP_SIZE || rest.length < MIN_GROUP_SIZE) return null;

  const completedAvg = average(completed.map((d) => d.fellAsleepMinutes as number));
  const restAvg = average(rest.map((d) => d.fellAsleepMinutes as number));
  const minutesFaster = restAvg - completedAvg;
  if (minutesFaster < 5) return null;

  return {
    key: 'habitsSleep',
    modules: ['habit', 'sleep'],
    strength: Math.min(1, minutesFaster / 30) * confidence(completed.length + rest.length, 16),
    params: { minutes: Math.round(minutesFaster) },
  };
}

/** Spending in the 1–2 days after a 'low'/'rough' mood entry vs. the overall
 *  daily average. */
function moodSpendingCandidate(daily: DailyMetrics[]): InsightCandidate | null {
  const sortedDates = daily.map((d) => d.date).sort();
  const byDate = new Map(daily.map((d) => [d.date, d]));
  const lowMoodDates = daily
    .filter((d) => d.mood === 'low' || d.mood === 'rough')
    .map((d) => d.date);
  if (lowMoodDates.length < MIN_LOW_MOOD_DAYS) return null;

  const afterLowMoodSpend: number[] = [];
  for (const date of lowMoodDates) {
    const index = sortedDates.indexOf(date);
    if (index === -1) continue;
    for (const offset of [1, 2]) {
      const followingDate = sortedDates[index + offset];
      const row = followingDate ? byDate.get(followingDate) : undefined;
      if (row) afterLowMoodSpend.push(row.spendCents);
    }
  }
  if (afterLowMoodSpend.length < MIN_LOW_MOOD_DAYS) return null;

  const baseline = average(daily.map((d) => d.spendCents));
  if (baseline <= 0) return null;
  const afterAvg = average(afterLowMoodSpend);
  const percent = (afterAvg - baseline) / baseline;
  if (percent < 0.15) return null;

  return {
    key: 'moodSpending',
    modules: ['journal', 'budget'],
    strength: Math.min(1, percent / 2) * confidence(afterLowMoodSpend.length, 8),
    params: { percent: Math.round(percent * 100) },
  };
}

const CANDIDATE_FNS = [sleepFocusCandidate, habitsSleepCandidate, moodSpendingCandidate];

/**
 * Compares every module pair the app can currently join and ranks whatever
 * clears its own honesty bar (see the per-candidate thresholds above) by
 * strength — the strongest becomes the headline, the rest become pattern
 * cards. Deliberately not machine learning: at the volume one person logs
 * (dozens to a few hundred days) a plain "compare two groups" split is both
 * more honest and easier to explain than a model would be, and a candidate
 * that can't clear its minimum sample size simply doesn't fire rather than
 * guessing from three data points.
 */
export function computeInsights(daily: DailyMetrics[]): InsightsResult {
  const loggedDays = daily.filter(
    (d) =>
      d.sleepMinutes != null ||
      d.studySeconds > 0 ||
      d.habitsScheduled > 0 ||
      d.spendCents > 0 ||
      d.mood != null,
  );

  const candidates = CANDIDATE_FNS.map((fn) => fn(daily))
    .filter((c): c is InsightCandidate => c !== null)
    .sort((a, b) => b.strength - a.strength);

  if (loggedDays.length < MIN_LOGGED_DAYS) {
    return { status: 'insufficient_data', headline: null, patterns: [] };
  }
  if (candidates.length === 0) {
    return { status: 'no_pattern_yet', headline: null, patterns: [] };
  }
  return { status: 'ready', headline: candidates[0], patterns: candidates.slice(1, 4) };
}
