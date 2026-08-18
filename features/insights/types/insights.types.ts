import type { MoodOption } from '@/features/journal/types/journal.types';

/**
 * One row per calendar day, joining every module's daily figure onto a single
 * key so cross-module comparisons don't each re-derive the join.
 *
 * This is the app's actual competitive asset: no collection of single-purpose
 * apps can produce this row, because their halves of it live in different
 * companies' databases. Every field added here is a metric the correlation
 * engine can pair with every other one, at no extra cost per pair — which is
 * why widening the row matters more than adding another hand-written insight.
 */
export type DailyMetrics = {
  date: string;

  // --- sleep ---
  sleepMinutes: number | null;
  sleepQuality: number | null;
  fellAsleepMinutes: number | null;
  /**
   * Bedtime as minutes after noon, so "later" is always a larger number.
   * Clock time cannot be averaged across midnight — 23:30 and 00:30 are half an
   * hour apart and average to 12:00, the exact opposite of both. Anchoring at
   * noon puts a normal night's range on one continuous scale.
   */
  bedtimeOffsetMinutes: number | null;
  wakeOffsetMinutes: number | null;

  // --- study ---
  studySeconds: number;
  focusRating: number | null;

  // --- habits ---
  habitsScheduled: number;
  habitsCompleted: number;

  // --- money ---
  spendCents: number;

  // --- journal ---
  mood: MoodOption | null;
  /** Mood as a 1–5 number so it can be an outcome, not only a filter. */
  moodScore: number | null;
  energy: number | null;
  stress: number | null;
  journalWords: number;

  // --- tasks ---
  tasksCompleted: number;
  tasksDue: number;

  // --- water ---
  waterMl: number;
};

/** Every numeric field on a day — the set a correlation spec may name. */
export type MetricKey = {
  [K in keyof DailyMetrics]: DailyMetrics[K] extends number | null ? K : never;
}[keyof DailyMetrics];

export type InsightModule = 'sleep' | 'study' | 'habit' | 'budget' | 'journal' | 'task' | 'water';

export type InsightKey =
  | 'sleepFocus'
  | 'habitsSleep'
  | 'moodSpending'
  | 'sleepMood'
  | 'bedtimeMood'
  | 'sleepTasks'
  | 'habitsMood'
  | 'stressSleep'
  | 'waterEnergy'
  | 'studyMood'
  | 'sleepSpending'
  | 'energyTasks'
  | 'journalMood'
  | 'lateNightSpending';

/**
 * A pattern the engine found, with the evidence behind it.
 *
 * `params` are the numbers the screen interpolates into that key's translated
 * sentence — the engine never produces English. The statistics are carried
 * alongside so the UI can be honest about strength rather than presenting every
 * finding with equal confidence.
 */
export type InsightCandidate = {
  key: InsightKey;
  modules: [InsightModule, InsightModule];
  /** 0–1, used only to rank candidates against each other. */
  strength: number;
  params: Record<string, number>;
  /** How many days of evidence the comparison actually rested on. */
  sampleSize: number;
  /** Two-tailed p-value from Welch's t-test on the two groups. */
  pValue: number;
  /** Whether the driver precedes the outcome, and by how many days. */
  lagDays: number;
};

export type InsightsStatus = 'insufficient_data' | 'no_pattern_yet' | 'ready';

export type InsightsResult = {
  status: InsightsStatus;
  headline: InsightCandidate | null;
  patterns: InsightCandidate[];
  /** How many pairs were tested to produce the above. Shown to the user,
   *  because "we checked 34 pairs and 2 stood out" is a fundamentally more
   *  honest claim than "we found 2 patterns". */
  pairsTested: number;
};
