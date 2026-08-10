import {
  contentTints,
  resolveTint,
  type ThemeName,
  type TintPair,
} from '@/constants/design-tokens';
import {
  Briefcase,
  Dumbbell,
  GraduationCap,
  Sparkles,
  Target,
  Wallet,
  type LucideIcon,
} from 'lucide-react-native';
import type { TFunction } from 'i18next';

import type { GoalCategory, GoalPriority } from '@/features/goals/types/goal.types';

export type GoalCategoryMeta = {
  id: GoalCategory;
  labelKey: string;
  icon: LucideIcon;
  /** Identity tint, readable on both light and dark cards. */
  tint: TintPair;
};

/**
 * Goal categories carry their own icon + tint so a goal reads at a glance in
 * the list without a color chip. 'custom' is the escape hatch — its label
 * comes from the goal's categoryLabel and it borrows the neutral brand accent.
 */
export const GOAL_CATEGORIES: GoalCategoryMeta[] = [
  { id: 'fitness', labelKey: 'goalCategory.fitness', icon: Dumbbell, tint: contentTints.orange },
  { id: 'study', labelKey: 'goalCategory.study', icon: GraduationCap, tint: contentTints.violet },
  { id: 'finance', labelKey: 'goalCategory.finance', icon: Wallet, tint: contentTints.green },
  { id: 'career', labelKey: 'goalCategory.career', icon: Briefcase, tint: contentTints.sky },
  { id: 'personal', labelKey: 'goalCategory.personal', icon: Sparkles, tint: contentTints.pink },
  { id: 'custom', labelKey: 'goalCategory.custom', icon: Target, tint: contentTints.teal },
];

const CATEGORY_BY_ID = new Map(GOAL_CATEGORIES.map((category) => [category.id, category]));

function categoryEntry(id: GoalCategory): GoalCategoryMeta {
  return CATEGORY_BY_ID.get(id) ?? GOAL_CATEGORIES[GOAL_CATEGORIES.length - 1];
}

/** The category's identity with its tint already resolved for `theme`.
 *
 *  The table holds a `TintPair`; resolving here rather than at each of the five
 *  render sites keeps every one of them from reaching for `.light` — which is
 *  how the Hub grid stopped retuning for dark mode. */
export function goalCategoryMeta(
  id: GoalCategory,
  theme: ThemeName,
): Omit<GoalCategoryMeta, 'tint'> & { tint: string } {
  const meta = categoryEntry(id);
  return { ...meta, tint: resolveTint(meta.tint, theme) };
}

/** Resolves the label to show — the custom free-text label when present,
 * otherwise the category's translated built-in name. */
export function goalCategoryLabel(
  category: GoalCategory,
  customLabel: string | null,
  t: TFunction,
): string {
  if (category === 'custom' && customLabel?.trim()) return customLabel.trim();
  return t(categoryEntry(category).labelKey);
}

export const GOAL_PRIORITIES: { id: GoalPriority; labelKey: string }[] = [
  { id: 'low', labelKey: 'fields.low' },
  { id: 'medium', labelKey: 'fields.medium' },
  { id: 'high', labelKey: 'fields.high' },
];
