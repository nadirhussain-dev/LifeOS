import {
  contentTints,
  resolveTint,
  type ThemeName,
  type TintPair,
} from '@/constants/design-tokens';
import {
  Banknote,
  Bus,
  Clapperboard,
  CreditCard,
  Dumbbell,
  GraduationCap,
  HeartPulse,
  Landmark,
  PiggyBank,
  Receipt,
  ShoppingBag,
  TrendingUp,
  Utensils,
  Wallet,
  type LucideIcon,
} from 'lucide-react-native';

import type {
  BudgetAccount,
  ExpenseCategoryId,
  IncomeCategoryId,
} from '@/features/budget/types/budget.types';

export type CategoryMeta<T extends string> = {
  id: T;
  label: string;
  icon: LucideIcon;
  tint: TintPair;
};

/** Fixed expense catalog — each drives an icon + tint in lists and the donut. */
export const EXPENSE_CATEGORIES: CategoryMeta<ExpenseCategoryId>[] = [
  { id: 'food', label: 'Food', icon: Utensils, tint: contentTints.orange },
  { id: 'shopping', label: 'Shopping', icon: ShoppingBag, tint: contentTints.pink },
  { id: 'gym', label: 'Gym', icon: Dumbbell, tint: contentTints.red },
  { id: 'education', label: 'Education', icon: GraduationCap, tint: contentTints.violet },
  { id: 'entertainment', label: 'Fun', icon: Clapperboard, tint: contentTints.purple },
  { id: 'transport', label: 'Transport', icon: Bus, tint: contentTints.sky },
  { id: 'bills', label: 'Bills', icon: Receipt, tint: contentTints.yellow },
  { id: 'health', label: 'Health', icon: HeartPulse, tint: contentTints.teal },
  { id: 'investment', label: 'Investment', icon: TrendingUp, tint: contentTints.green },
  { id: 'others', label: 'Other', icon: CreditCard, tint: contentTints.neutral },
];

export const INCOME_CATEGORIES: CategoryMeta<IncomeCategoryId>[] = [
  { id: 'salary', label: 'Salary', icon: Banknote, tint: contentTints.green },
  { id: 'freelance', label: 'Freelance', icon: Wallet, tint: contentTints.sky },
  { id: 'gift', label: 'Gift', icon: PiggyBank, tint: contentTints.pink },
  { id: 'investment', label: 'Investment', icon: TrendingUp, tint: contentTints.violet },
  { id: 'other', label: 'Other', icon: CreditCard, tint: contentTints.neutral },
];

export const ACCOUNTS: { id: BudgetAccount; label: string; icon: LucideIcon }[] = [
  { id: 'cash', label: 'Cash', icon: Banknote },
  { id: 'wallet', label: 'Wallet', icon: Wallet },
  { id: 'bank', label: 'Bank', icon: Landmark },
];

const EXPENSE_BY_ID = new Map(EXPENSE_CATEGORIES.map((c) => [c.id, c]));
const INCOME_BY_ID = new Map(INCOME_CATEGORIES.map((c) => [c.id, c]));

/** A category's identity with its tint resolved for the active theme.
 *
 *  The tables hold `TintPair`s so the swatches finally have a dark column;
 *  these accessors resolve one so no screen has to reach into `.light`. */
export type ResolvedCategoryMeta = {
  label: string;
  icon: LucideIcon;
  tint: string;
};

function expenseEntry(id: string): CategoryMeta<ExpenseCategoryId> {
  return (
    EXPENSE_BY_ID.get(id as ExpenseCategoryId) ?? EXPENSE_CATEGORIES[EXPENSE_CATEGORIES.length - 1]
  );
}

function incomeEntry(id: string): CategoryMeta<IncomeCategoryId> {
  return (
    INCOME_BY_ID.get(id as IncomeCategoryId) ?? INCOME_CATEGORIES[INCOME_CATEGORIES.length - 1]
  );
}

export function expenseCategoryMeta(id: string, theme: ThemeName): ResolvedCategoryMeta {
  const meta = expenseEntry(id);
  return { ...meta, tint: resolveTint(meta.tint, theme) };
}

export function incomeCategoryMeta(id: string, theme: ThemeName): ResolvedCategoryMeta {
  const meta = incomeEntry(id);
  return { ...meta, tint: resolveTint(meta.tint, theme) };
}

/**
 * Just the display label, with no theme involved.
 *
 * Search and grouping need the name and nothing else. Reaching for the full
 * `categoryMetaFor` there would drag the active theme into a `useMemo` that has
 * no business depending on it — and re-group the entire transaction history
 * every time the user switches to dark mode.
 */
export function categoryLabelFor(type: string, categoryId: string): string {
  if (type === 'income') return incomeEntry(categoryId).label;
  if (type === 'savings') return 'Savings';
  return expenseEntry(categoryId).label;
}

/** Resolves category icon + tint for any transaction type (savings has no
 * sub-category, so it uses a fixed piggy-bank identity). */
export function categoryMetaFor(
  type: string,
  categoryId: string,
  theme: ThemeName,
): ResolvedCategoryMeta {
  if (type === 'income') return incomeCategoryMeta(categoryId, theme);
  if (type === 'savings') {
    return { label: 'Savings', icon: PiggyBank, tint: resolveTint(contentTints.indigo, theme) };
  }
  return expenseCategoryMeta(categoryId, theme);
}

// Was its own near-copy of the content palette: five of the same six swatches
// in a different order, plus indigo. Named entries now, so a savings goal and
// a task category that pick "violet" are the same violet.
//
// Stays a list of plain hexes, unlike the category tables above, because these
// are PERSISTED — the chosen value is written to `savings_goals.colorToken`.
// A stored `TintPair` would put today's dark-mode hex in the database and
// freeze it there. Resolve a stored one for display with `readableTint()`.
export const SAVINGS_COLORS: string[] = [
  contentTints.indigo.light,
  contentTints.green.light,
  contentTints.orange.light,
  contentTints.pink.light,
  contentTints.sky.light,
  contentTints.violet.light,
];
