import { subDays } from 'date-fns/subDays';
import { useQuery } from '@tanstack/react-query';

import { listDailyTotals } from '@/features/water-intake/services/water-intake-repository';
import { toDateKey } from '@/lib/date';

export function useWaterHistory(days = 14) {
  return useQuery({
    queryKey: ['water-intake', 'history', days],
    queryFn: async () => {
      const end = toDateKey(new Date());
      const start = toDateKey(subDays(new Date(), days - 1));
      return listDailyTotals(start, end);
    },
  });
}
