import { useMemo } from 'react';

import { useLifeInsights } from '@/features/insights/hooks/use-insights';
import { buildWeeklyReview } from '@/features/insights/services/weekly-review';

/**
 * The weekly review, over the same join the Insights screen uses.
 *
 * Fourteen days, because the review is a comparison: this week against last.
 * Reusing `useLifeInsights` means the two screens share every underlying query,
 * so opening the review after the insights screen costs nothing and the numbers
 * on both cannot disagree.
 */
export function useWeeklyReview() {
  const { daily, insights, isLoading, isError, refetch } = useLifeInsights(14);

  const review = useMemo(() => buildWeeklyReview(daily), [daily]);

  return { review, insights, isLoading, isError, refetch };
}
