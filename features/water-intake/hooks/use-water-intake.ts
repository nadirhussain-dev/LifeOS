import { useQueryClient, useMutation, useQuery } from '@tanstack/react-query';

import {
  getDailyTotal,
  listLogsForDate,
  logWater,
  undoLastLog,
} from '@/features/water-intake/services/water-intake-repository';
import { toDateKey } from '@/lib/date';

export function useTodayWaterTotal() {
  return useQuery({
    queryKey: ['water-intake', 'today'],
    queryFn: async () => getDailyTotal(toDateKey(new Date())),
  });
}

export function useWaterIntakeMutations() {
  const queryClient = useQueryClient();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['water-intake'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard', 'today-timeline'] });
    queryClient.invalidateQueries({ queryKey: ['timeline'] });
    // Widget refresh via the query-cache subscription (use-widget-sync).
  };

  /**
   * Moves the day's total before the write lands.
   *
   * Logging a glass is the highest-frequency action in the app and the most
   * visibly synchronous: the ring, the tile and the widget all read this one
   * number, and until the refetch returned, tapping "+1" left every one of them
   * showing the old figure. The read is a `SUM` over the day's rows, so the
   * optimistic value is the same arithmetic — add the amount, floor at zero —
   * rather than a guess the refetch has to correct.
   *
   * Only the `today` key is written optimistically. History and the timeline
   * are read on screens the user is not looking at while tapping a glass, and
   * inventing rows for them would mean predicting ids the repository assigns.
   */
  const TODAY_KEY = ['water-intake', 'today'];

  const shiftTodayTotal = async (deltaMl: number) => {
    await queryClient.cancelQueries({ queryKey: TODAY_KEY });
    const previous = queryClient.getQueryData<number>(TODAY_KEY);
    queryClient.setQueryData<number>(TODAY_KEY, (current) => Math.max(0, (current ?? 0) + deltaMl));
    return { previous };
  };

  const rollback = (context: { previous: number | undefined } | undefined) => {
    if (context?.previous !== undefined) queryClient.setQueryData(TODAY_KEY, context.previous);
  };

  const addWater = useMutation({
    mutationFn: async (amountMl: number) => logWater(amountMl),
    onMutate: (amountMl: number) => shiftTodayTotal(amountMl),
    onError: (_error, _amountMl, context) => rollback(context),
    onSettled: invalidate,
  });

  const undoLast = useMutation({
    mutationFn: async () => undoLastLog(),
    // The undone glass is the last one logged, and its size is not known here
    // without reading the day's rows — so this reads them rather than assuming
    // a standard glass. Undoing a 500ml bottle must not subtract 250.
    onMutate: async () => {
      const logs = listLogsForDate(toDateKey(new Date()));
      const last = logs[logs.length - 1];
      return shiftTodayTotal(last ? -last.amountMl : 0);
    },
    onError: (_error, _variables, context) => rollback(context),
    onSettled: invalidate,
  });

  return { addWater, undoLast };
}
