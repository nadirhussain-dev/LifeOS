import type { MoodOption } from '@/features/journal/types/journal.types';

/** One row per calendar day, joining every module's daily figure onto a
 *  single key so cross-module comparisons don't each re-derive the join. */
export type DailyMetrics = {
  date: string;
  sleepMinutes: number | null;
  sleepQuality: number | null;
  fellAsleepMinutes: number | null;
  studySeconds: number;
  focusRating: number | null;
  habitsScheduled: number;
  habitsCompleted: number;
  spendCents: number;
  mood: MoodOption | null;
};

export type InsightModule = 'sleep' | 'study' | 'habit' | 'budget' | 'journal';

export type InsightKey = 'sleepFocus' | 'habitsSleep' | 'moodSpending';

/** A candidate correlation the engine found. `params` are the numbers the
 *  screen interpolates into that key's translated sentence — the engine never
 *  produces English text itself. */
export type InsightCandidate = {
  key: InsightKey;
  modules: [InsightModule, InsightModule];
  /** 0–1, used only to rank candidates against each other. */
  strength: number;
  params: Record<string, number>;
};

export type InsightsStatus = 'insufficient_data' | 'no_pattern_yet' | 'ready';

export type InsightsResult = {
  status: InsightsStatus;
  headline: InsightCandidate | null;
  patterns: InsightCandidate[];
};
