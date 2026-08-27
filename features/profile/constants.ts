import {
  BookHeart,
  CheckSquare,
  Dumbbell,
  GlassWater,
  GraduationCap,
  Moon,
  Repeat,
  Target,
  Wallet,
  type LucideIcon,
} from '@/components/ui/icons';
import { moduleTint, type ModuleName, type ThemeName } from '@/constants/design-tokens';
import { colors } from '@/constants/theme';
import type { FocusArea, Gender } from '@/features/profile/store/profile-store';

/** The life areas a user can pick during onboarding. Each carries its module
 *  identity tint so the focus grid reads in the same color language as the app,
 *  and the route its dashboard shortcut deep-links to.
 *  `module: null` = no dedicated module tint, falls back to the brand accent. */
export const FOCUS_AREAS: {
  id: FocusArea;
  /** i18n key for the display label (see the `focus` namespace). */
  labelKey: string;
  icon: LucideIcon;
  module: ModuleName | null;
  route: string;
}[] = [
  {
    id: 'habits',
    labelKey: 'focus.habits',
    icon: Repeat,
    module: 'habit',
    route: '/(tabs)/habits',
  },
  { id: 'tasks', labelKey: 'focus.tasks', icon: CheckSquare, module: null, route: '/(tabs)/tasks' },
  {
    id: 'journal',
    labelKey: 'focus.journal',
    icon: BookHeart,
    module: 'journal',
    route: '/(tabs)/journal',
  },
  {
    id: 'water',
    labelKey: 'focus.hydration',
    icon: GlassWater,
    module: 'water',
    route: '/water-intake/history',
  },
  { id: 'sleep', labelKey: 'focus.sleep', icon: Moon, module: 'sleep', route: '/sleep' },
  {
    id: 'fitness',
    labelKey: 'focus.fitness',
    icon: Dumbbell,
    module: 'fitness',
    route: '/gallery',
  },
  { id: 'goals', labelKey: 'focus.goals', icon: Target, module: 'goals', route: '/goals' },
  { id: 'budget', labelKey: 'focus.budget', icon: Wallet, module: 'budget', route: '/budget' },
  { id: 'study', labelKey: 'focus.study', icon: GraduationCap, module: 'study', route: '/study' },
];

/** Resolve a focus area's tint for the active theme (accent when it has none). */
export function focusTint(module: ModuleName | null, theme: ThemeName): string {
  return module ? moduleTint(module, theme) : colors[theme].accent;
}

/**
 * The gender options offered during onboarding.
 *
 * "Prefer not to say" is a real, first-class answer rather than a polite
 * afterthought: the only thing this question feeds is which private modules get
 * pre-ticked, and somebody who declines simply gets the universal suggestion.
 * The step is skippable for the same reason.
 */
export const GENDER_OPTIONS: { id: Gender; labelKey: string }[] = [
  { id: 'female', labelKey: 'gender.female' },
  { id: 'male', labelKey: 'gender.male' },
  { id: 'non_binary', labelKey: 'gender.nonBinary' },
  { id: 'prefer_not_to_say', labelKey: 'gender.preferNotToSay' },
];
