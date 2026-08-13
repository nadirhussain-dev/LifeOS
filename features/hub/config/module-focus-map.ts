import type { FocusArea } from '@/features/profile/store/profile-store';

/**
 * Which onboarding focus area "unlocks" each Hub module in the curated view.
 *
 * Not every module is here on purpose. `habits`/`tasks`/`journal` are focus
 * areas but have no Hub entry (they're bottom tabs, always visible); `notes`,
 * `timeline`, `split`, `music` and `settings` are Hub modules with no
 * corresponding focus question, so curation leaves them alone rather than
 * hiding something the user was never asked about. `fitness` maps to Gallery
 * — the same mapping FOCUS_AREAS itself uses (its route is `/gallery`).
 */
export const MODULE_FOCUS_MAP: Partial<Record<string, FocusArea>> = {
  goals: 'goals',
  study: 'study',
  sleep: 'sleep',
  water: 'water',
  budget: 'budget',
  gallery: 'fitness',
};
