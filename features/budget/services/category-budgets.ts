import type { CategoryBudgetStatus } from '@/features/budget/types/budget.types';

/**
 * How a month's spending sits against its per-category caps.
 *
 * A monthly total alone tells you that you overspent; it does not tell you
 * where, which is the only version of that information anybody can act on. This
 * is the arithmetic behind that, kept pure because every number it produces is
 * shown to somebody as a fact about their money.
 */

/**
 * Where one category stands.
 *
 * `ratio` is uncapped deliberately — clamping it to 1 would make 20% over
 * budget and 300% over budget render identically, and those are not the same
 * month. The bar is what clamps; the number does not.
 */
export function categoryStatus(
  category: string,
  spentCents: number,
  limitCents: number,
): CategoryBudgetStatus {
  // A cap of zero is a real intention — "I plan to spend nothing here" — and is
  // not the same as no cap at all. Anything spent against it is over budget, and
  // there is no ratio that expresses that, so it saturates rather than dividing.
  const ratio =
    limitCents === 0 ? (spentCents > 0 ? Number.POSITIVE_INFINITY : 0) : spentCents / limitCents;

  return {
    category,
    spentCents,
    limitCents,
    remainingCents: limitCents - spentCents,
    ratio,
    isOver: spentCents > limitCents,
  };
}

/**
 * Every capped category's standing, worst first.
 *
 * Sorted by how far over or close to the cap each is, because the reason to open
 * this list is to find the problem — ordering by catalog position buries it
 * among nine categories that are fine.
 *
 * Uncapped categories are absent rather than present with a zero limit. A
 * category nobody has capped is not "0% of nothing spent", it is a category
 * this feature has no opinion about.
 */
export function categoryBudgetStatuses(
  spentByCategory: Record<string, number>,
  limitsByCategory: Record<string, number>,
): CategoryBudgetStatus[] {
  return Object.entries(limitsByCategory)
    .map(([category, limitCents]) =>
      categoryStatus(category, spentByCategory[category] ?? 0, limitCents),
    )
    .sort((a, b) => b.ratio - a.ratio);
}

/**
 * The caps' total against the month's overall budget, so the two settings can
 * be reconciled on screen.
 *
 * Returned rather than enforced: capping categories above the monthly budget is
 * a contradiction the user is allowed to hold — they may be mid-way through
 * re-planning — and refusing the edit would be the app arguing with them about
 * their own money. Saying so is enough.
 */
export function capsExceedMonthlyBudget(
  limitsByCategory: Record<string, number>,
  monthlyBudgetCents: number | null,
): boolean {
  if (monthlyBudgetCents == null) return false;
  const total = Object.values(limitsByCategory).reduce((sum, cents) => sum + cents, 0);
  return total > monthlyBudgetCents;
}
