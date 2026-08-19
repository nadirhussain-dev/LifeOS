import type { MetricKey } from '@/features/insights/types/insights.types';

/** Translation key for each reviewed metric's label. */
export const REVIEW_METRIC_LABEL: Partial<Record<MetricKey, string>> = {
  sleepMinutes: 'insights.metricSleepMinutes',
  habitsCompleted: 'insights.metricHabitsCompleted',
  tasksCompleted: 'insights.metricTasksCompleted',
  moodScore: 'insights.metricMoodScore',
  energy: 'insights.metricEnergy',
  waterMl: 'insights.metricWaterMl',
  studySeconds: 'insights.metricStudySeconds',
  stress: 'insights.metricStress',
  spendCents: 'insights.metricSpendCents',
};

/**
 * A metric's weekly mean, in the unit a person thinks in.
 *
 * Minutes become hours, seconds become minutes, cents become whole currency
 * units. The review is read at a glance on a Sunday evening, and "426" is not a
 * quantity of sleep anybody recognises.
 *
 * Currency is deliberately not formatted here: `formatMoney` needs the user's
 * currency and this module is pure and unit-agnostic, so the screen applies it.
 */
export function formatReviewValue(key: MetricKey, value: number): string {
  switch (key) {
    case 'sleepMinutes':
      return `${(value / 60).toFixed(1)}h`;
    case 'studySeconds':
      return `${Math.round(value / 60)}m`;
    case 'waterMl':
      return `${(value / 1000).toFixed(1)}L`;
    case 'moodScore':
    case 'energy':
    case 'stress':
      return value.toFixed(1);
    default:
      return value < 10 ? value.toFixed(1) : String(Math.round(value));
  }
}

/** A signed percentage, rounded, for the change chip. */
export function formatChange(relativeChange: number): string {
  const percent = Math.round(relativeChange * 100);
  return `${percent > 0 ? '+' : ''}${percent}%`;
}
