import {
  BookOpen,
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
};

export const INSIGHT_MODULE_ICON: Record<InsightModule, LucideIcon> = {
  sleep: Moon,
  study: GraduationCap,
  habit: Repeat,
  budget: Wallet,
  journal: BookOpen,
};

/** Translation key for each candidate's full sentence — the engine only ever
 *  produces `{ key, params }`, never English text, so this is the one place
 *  that turns a candidate into copy. */
export const INSIGHT_SENTENCE_KEY: Record<InsightKey, string> = {
  sleepFocus: 'insights.sleepFocusSentence',
  habitsSleep: 'insights.habitsSleepSentence',
  moodSpending: 'insights.moodSpendingSentence',
};
