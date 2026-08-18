import {
  BookOpen,
  CheckSquare,
  Droplet,
  GraduationCap,
  Moon,
  Repeat,
  Wallet,
  type LucideIcon,
} from 'lucide-react-native';

import type { ModuleName } from '@/constants/design-tokens';
import type { InsightKey, InsightModule } from '@/features/insights/types/insights.types';

/**
 * `InsightModule` values are deliberately the same strings as the relevant
 * `ModuleName` keys in the design-token registry, so a candidate's module
 * pair resolves straight to that module's existing Hub tint — Insights
 * doesn't get (or need) a tint of its own for these chips.
 */
export const INSIGHT_MODULE_TOKEN: Record<InsightModule, ModuleName> = {
  sleep: 'sleep',
  study: 'study',
  habit: 'habit',
  budget: 'budget',
  journal: 'journal',
  task: 'calendar',
  water: 'water',
};

export const INSIGHT_MODULE_ICON: Record<InsightModule, LucideIcon> = {
  sleep: Moon,
  study: GraduationCap,
  habit: Repeat,
  budget: Wallet,
  journal: BookOpen,
  task: CheckSquare,
  water: Droplet,
};

/**
 * Translation key for each candidate's full sentence — the engine only ever
 * produces `{ key, params }`, never English text, so this is the one place that
 * turns a candidate into copy.
 *
 * Every sentence is written as co-occurrence, not cause. "On days you sleep 7+
 * hours, your focus runs 20% higher" is what the arithmetic supports; "sleeping
 * more improves your focus" is not, and a two-group comparison over one
 * person's log can never support it. The engine's guards make the numbers
 * trustworthy; this file is what stops the sentence overclaiming them.
 */
export const INSIGHT_SENTENCE_KEY: Record<InsightKey, string> = {
  sleepFocus: 'insights.sleepFocusSentence',
  habitsSleep: 'insights.habitsSleepSentence',
  moodSpending: 'insights.moodSpendingSentence',
  sleepMood: 'insights.sleepMoodSentence',
  bedtimeMood: 'insights.bedtimeMoodSentence',
  sleepTasks: 'insights.sleepTasksSentence',
  habitsMood: 'insights.habitsMoodSentence',
  stressSleep: 'insights.stressSleepSentence',
  waterEnergy: 'insights.waterEnergySentence',
  studyMood: 'insights.studyMoodSentence',
  sleepSpending: 'insights.sleepSpendingSentence',
  energyTasks: 'insights.energyTasksSentence',
  journalMood: 'insights.journalMoodSentence',
  lateNightSpending: 'insights.lateNightSpendingSentence',
};
