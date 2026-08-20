import { View } from 'react-native';

import { Skeleton } from '@/components/ui/skeleton';

/**
 * Placeholder rows for a list that is still loading.
 *
 * Exists because several screens rendered `query.data ?? []` straight into a
 * `.map()`, so while the query was in flight they drew an empty list — which
 * reads as "there is nothing here" rather than "this has not arrived". The
 * operator console was the worst of it: those screens hit the network
 * unconditionally, so they are the ones most likely to be slow, and they were
 * the ones saying "no coupons" while the request was still open.
 *
 * Widths vary per row so the block reads as text rather than as a bar chart.
 */
export function ListSkeleton({ rows = 3, className }: { rows?: number; className?: string }) {
  const widths = ['w-2/3', 'w-1/2', 'w-3/4', 'w-2/5', 'w-3/5'];

  return (
    <View className={className ?? 'gap-3 py-3'}>
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} className="gap-1.5">
          <Skeleton className={`h-4 ${widths[i % widths.length]}`} />
          <Skeleton className="h-3 w-1/4" />
        </View>
      ))}
    </View>
  );
}
