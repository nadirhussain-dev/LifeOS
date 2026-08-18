import type {
  InsightKey,
  InsightModule,
  MetricKey,
} from '@/features/insights/types/insights.types';

/**
 * Every cross-module comparison the engine makes, as data.
 *
 * This table is the point of the rewrite. Each entry used to be a hand-written
 * function — thirty lines of filtering, averaging and threshold-checking, three
 * of them in total — so adding a comparison meant writing arithmetic that could
 * be subtly wrong in a new way, and nobody was going to write forty of those.
 * Here a new comparison is one row, and every row is evaluated by the same
 * tested code path.
 *
 * Cheap comparisons are exactly what makes the honesty guards non-optional. At
 * this many pairs, roughly one in twenty will look significant at p<0.05 by
 * chance alone, so `insight-engine.ts` runs Welch's t-test on each and applies
 * a Benjamini–Hochberg correction across the whole set before anything is shown.
 */
export type CorrelationSpec = {
  key: InsightKey;
  /** The metric whose value splits days into two groups. */
  driver: MetricKey;
  /** The metric compared between those groups. */
  outcome: MetricKey;
  /**
   * Where the split falls. `median` adapts to the person, which is almost
   * always what you want — "a lot of sleep for you" is not a fixed number — but
   * a `threshold` is right where the number means something in itself, like
   * seven hours or a completed schedule.
   */
  split: { kind: 'median' } | { kind: 'threshold'; at: number };
  /**
   * Days between the driver day and the outcome day. 0 compares the same day;
   * 1 asks whether last night predicts today, which is the only form in which
   * some of these questions make sense at all.
   */
  lagDays: number;
  /** Which way round a difference is worth reporting. */
  expect: 'higher' | 'lower';
  /** Minimum days in each group before the comparison is attempted. */
  minGroup: number;
  /**
   * Minimum relative difference between the groups, as a fraction of the lower
   * group's mean. Significance and size are different questions: a large enough
   * sample makes a 0.3% difference statistically real and still not worth a
   * sentence on a screen.
   */
  effectFloor: number;
  modules: [InsightModule, InsightModule];
};

const SEVEN_HOURS = 420;
const SIX_HOURS = 360;

export const CORRELATION_SPECS: CorrelationSpec[] = [
  // --- sleep as a driver -----------------------------------------------------
  {
    key: 'sleepFocus',
    driver: 'sleepMinutes',
    outcome: 'focusRating',
    split: { kind: 'threshold', at: SEVEN_HOURS },
    lagDays: 0,
    expect: 'higher',
    minGroup: 4,
    effectFloor: 0.08,
    modules: ['sleep', 'study'],
  },
  {
    key: 'sleepMood',
    driver: 'sleepMinutes',
    outcome: 'moodScore',
    split: { kind: 'threshold', at: SEVEN_HOURS },
    lagDays: 0,
    expect: 'higher',
    minGroup: 4,
    effectFloor: 0.08,
    modules: ['sleep', 'journal'],
  },
  {
    key: 'sleepTasks',
    driver: 'sleepMinutes',
    outcome: 'tasksCompleted',
    split: { kind: 'threshold', at: SEVEN_HOURS },
    lagDays: 0,
    expect: 'higher',
    minGroup: 4,
    effectFloor: 0.12,
    modules: ['sleep', 'task'],
  },
  {
    key: 'sleepSpending',
    driver: 'sleepMinutes',
    outcome: 'spendCents',
    split: { kind: 'threshold', at: SIX_HOURS },
    lagDays: 0,
    expect: 'lower',
    minGroup: 4,
    effectFloor: 0.15,
    modules: ['sleep', 'budget'],
  },
  {
    key: 'bedtimeMood',
    driver: 'bedtimeOffsetMinutes',
    outcome: 'moodScore',
    split: { kind: 'median' },
    // Last night's bedtime against today's mood: the same-day comparison would
    // be asking whether tonight's bedtime affected this morning.
    lagDays: 1,
    expect: 'lower',
    minGroup: 4,
    effectFloor: 0.08,
    modules: ['sleep', 'journal'],
  },
  {
    key: 'lateNightSpending',
    driver: 'bedtimeOffsetMinutes',
    outcome: 'spendCents',
    split: { kind: 'median' },
    lagDays: 0,
    expect: 'higher',
    minGroup: 4,
    effectFloor: 0.15,
    modules: ['sleep', 'budget'],
  },

  // --- habits as a driver ---------------------------------------------------
  {
    key: 'habitsSleep',
    driver: 'habitsCompleted',
    outcome: 'fellAsleepMinutes',
    split: { kind: 'median' },
    lagDays: 0,
    expect: 'lower',
    minGroup: 4,
    effectFloor: 0.1,
    modules: ['habit', 'sleep'],
  },
  {
    key: 'habitsMood',
    driver: 'habitsCompleted',
    outcome: 'moodScore',
    split: { kind: 'median' },
    lagDays: 0,
    expect: 'higher',
    minGroup: 4,
    effectFloor: 0.08,
    modules: ['habit', 'journal'],
  },

  // --- mood and stress as drivers -------------------------------------------
  {
    key: 'moodSpending',
    driver: 'moodScore',
    outcome: 'spendCents',
    split: { kind: 'median' },
    // Yesterday's mood against today's spending — the delayed version of the
    // original hand-written candidate, which averaged a 1–2 day window.
    lagDays: 1,
    expect: 'lower',
    minGroup: 3,
    effectFloor: 0.15,
    modules: ['journal', 'budget'],
  },
  {
    key: 'stressSleep',
    driver: 'stress',
    outcome: 'sleepMinutes',
    split: { kind: 'median' },
    lagDays: 0,
    expect: 'lower',
    minGroup: 4,
    effectFloor: 0.08,
    modules: ['journal', 'sleep'],
  },
  {
    key: 'energyTasks',
    driver: 'energy',
    outcome: 'tasksCompleted',
    split: { kind: 'median' },
    lagDays: 0,
    expect: 'higher',
    minGroup: 4,
    effectFloor: 0.12,
    modules: ['journal', 'task'],
  },
  {
    key: 'journalMood',
    driver: 'journalWords',
    outcome: 'moodScore',
    split: { kind: 'median' },
    lagDays: 0,
    expect: 'higher',
    minGroup: 4,
    effectFloor: 0.08,
    modules: ['journal', 'journal'],
  },

  // --- other modules as drivers ---------------------------------------------
  {
    key: 'waterEnergy',
    driver: 'waterMl',
    outcome: 'energy',
    split: { kind: 'median' },
    lagDays: 0,
    expect: 'higher',
    minGroup: 4,
    effectFloor: 0.08,
    modules: ['water', 'journal'],
  },
  {
    key: 'studyMood',
    driver: 'studySeconds',
    outcome: 'moodScore',
    split: { kind: 'median' },
    lagDays: 0,
    expect: 'higher',
    minGroup: 4,
    effectFloor: 0.08,
    modules: ['study', 'journal'],
  },
];
