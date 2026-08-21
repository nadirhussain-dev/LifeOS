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

/**
 * The four self-reported dimensions on the mood check-in.
 *
 * These were four hex literals in mood-checkin.tsx with no dark column, so all
 * four drew their light value on a near-black card. Every light value here is
 * the one that was hardcoded, so light mode is unchanged and only dark is new.
 *
 * `sleep` takes content violet rather than the Sleep *module*'s indigo, which
 * is what it already did. Worth knowing that it is a divergence: this is a
 * self-reported metric on a journal entry, not the Sleep module, and echoing the
 * module here is a design call rather than a mechanical one.
 */
export const MOOD_DIMENSION_TINT = {
  energy: contentTints.green,
  stress: contentTints.orange,
  focus: contentTints.sky,
  sleep: contentTints.violet,
} as const satisfies Record<string, TintPair>;
