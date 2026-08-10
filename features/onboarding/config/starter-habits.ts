import type { HabitScheduleType, HabitType } from '@/features/habits/types/habit.types';
import type { FocusArea } from '@/features/profile/store/profile-store';

/**
 * Habits offered during onboarding, keyed to the life areas the user picked.
 *
 * The point of these is not the habits themselves — it is that onboarding stops
 * being a survey. Five screens of questions followed by an empty dashboard is
 * the standard way a good app loses somebody in the first minute: they have told
 * it everything about themselves and it has given them nothing back. Ticking two
 * of these means the first screen after setup already has their name on it and
 * something on it to do.
 *
 * They are suggestions, pre-ticked for nothing, and the step says they can be
 * changed later — because a starter habit somebody did not ask for is clutter,
 * and clutter in an empty app is worse than emptiness.
 *
 * Chosen to be small. "Move for 30 minutes" is a habit; "Get fit" is a wish, and
 * a wish that goes un-ticked for a fortnight teaches people the app is somewhere
 * they fail.
 */
export type StarterHabit = {
  id: string;
  /** i18n key under `starterHabit`. */
  labelKey: string;
  emoji: string;
  /** The focus area that surfaces this suggestion. */
  focus: FocusArea;
  type: HabitType;
  scheduleType: HabitScheduleType;
  targetValue?: number;
  /** i18n key for the unit shown on a count/duration habit. */
  unitKey?: string;
};

export const STARTER_HABITS: StarterHabit[] = [
  // habits
  {
    id: 'make-bed',
    labelKey: 'starterHabit.makeBed',
    emoji: '🛏️',
    focus: 'habits',
    type: 'boolean',
    scheduleType: 'daily',
  },
  {
    id: 'tidy-ten',
    labelKey: 'starterHabit.tidyTen',
    emoji: '🧹',
    focus: 'habits',
    type: 'duration',
    scheduleType: 'daily',
    targetValue: 10,
    unitKey: 'starterHabit.unitMinutes',
  },
  // fitness
  {
    id: 'move-daily',
    labelKey: 'starterHabit.moveDaily',
    emoji: '🏃',
    focus: 'fitness',
    type: 'duration',
    scheduleType: 'daily',
    targetValue: 30,
    unitKey: 'starterHabit.unitMinutes',
  },
  {
    id: 'stretch',
    labelKey: 'starterHabit.stretch',
    emoji: '🧘',
    focus: 'fitness',
    type: 'boolean',
    scheduleType: 'daily',
  },
  // sleep
  {
    id: 'lights-out',
    labelKey: 'starterHabit.lightsOut',
    emoji: '🌙',
    focus: 'sleep',
    type: 'boolean',
    scheduleType: 'daily',
  },
  {
    /** A `negative` habit: the win is not doing it. */
    id: 'no-screens',
    labelKey: 'starterHabit.noScreens',
    emoji: '📵',
    focus: 'sleep',
    type: 'negative',
    scheduleType: 'daily',
  },
  // water
  {
    id: 'water-on-waking',
    labelKey: 'starterHabit.waterOnWaking',
    emoji: '💧',
    focus: 'water',
    type: 'boolean',
    scheduleType: 'daily',
  },
  // journal
  {
    id: 'three-lines',
    labelKey: 'starterHabit.threeLines',
    emoji: '✍️',
    focus: 'journal',
    type: 'boolean',
    scheduleType: 'daily',
  },
  {
    id: 'one-good-thing',
    labelKey: 'starterHabit.oneGoodThing',
    emoji: '🌤️',
    focus: 'journal',
    type: 'boolean',
    scheduleType: 'daily',
  },
  // study
  {
    id: 'study-block',
    labelKey: 'starterHabit.studyBlock',
    emoji: '📚',
    focus: 'study',
    type: 'duration',
    scheduleType: 'daily',
    targetValue: 25,
    unitKey: 'starterHabit.unitMinutes',
  },
  // budget
  {
    id: 'log-spending',
    labelKey: 'starterHabit.logSpending',
    emoji: '🧾',
    focus: 'budget',
    type: 'boolean',
    scheduleType: 'daily',
  },
  // goals
  {
    id: 'weekly-review',
    labelKey: 'starterHabit.weeklyReview',
    emoji: '🎯',
    focus: 'goals',
    type: 'boolean',
    scheduleType: 'weekly',
  },
  // tasks
  {
    id: 'plan-tomorrow',
    labelKey: 'starterHabit.planTomorrow',
    emoji: '🗒️',
    focus: 'tasks',
    type: 'boolean',
    scheduleType: 'daily',
  },
];

/**
 * Suggestions for the areas someone picked, capped.
 *
 * The cap is the whole reason this is a function. Somebody who picks all nine
 * areas — which the focus step actively invites, because picking is fun — would
 * otherwise be shown thirteen checkboxes on the step that is supposed to feel
 * like the app doing the work. Six is enough to feel tailored and few enough to
 * read without scrolling on a small phone.
 */
export const MAX_SUGGESTIONS = 6;

export function suggestedHabits(focusAreas: FocusArea[]): StarterHabit[] {
  if (focusAreas.length === 0) return [];
  // Ordered by the user's own picks rather than by the order of the list above,
  // so the first suggestions belong to the first thing they said mattered.
  const ordered = focusAreas.flatMap((focus) => STARTER_HABITS.filter((h) => h.focus === focus));
  return ordered.slice(0, MAX_SUGGESTIONS);
}
