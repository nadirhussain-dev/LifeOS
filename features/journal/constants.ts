import { contentTints, type TintPair } from '@/constants/design-tokens';
import type { MoodOption } from '@/features/journal/types/journal.types';

export const MOOD_EMOJI: Record<MoodOption, string> = {
  great: '😄',
  good: '🙂',
  okay: '😐',
  low: '😕',
  rough: '😣',
};

/** i18n keys for each mood (see the `mood` namespace). */
export const MOOD_LABEL_KEY: Record<MoodOption, string> = {
  great: 'mood.moodGreat',
  good: 'mood.moodGood',
  okay: 'mood.moodOkay',
  low: 'mood.moodLow',
  rough: 'mood.moodRough',
};

// A calm, non-judgmental color per mood — never the app's destructive red,
// so a hard day reads as "noted" rather than "wrong."
export const MOOD_TINT: Record<MoodOption, TintPair> = {
  great: contentTints.green,
  good: contentTints.lime,
  okay: contentTints.yellow,
  low: contentTints.sky,
  rough: contentTints.orange,
};
