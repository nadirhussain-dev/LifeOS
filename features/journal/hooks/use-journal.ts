import { endOfMonth, startOfMonth } from 'date-fns';
import { useQuery } from '@tanstack/react-query';

import { calculateJournalStreak } from '@/features/journal/services/journal-streak';
import {
  listEntriesBetween,
  listEntriesOnMonthDay,
} from '@/features/journal/services/journal-repository';
import { monthDay, onThisDay, yearOf } from '@/features/journal/services/on-this-day';
import { useJournalFilterStore } from '@/features/journal/store/journal-filter-store';
import { toDateKey } from '@/lib/date';

export function useJournalMonth() {
  const { visibleMonth } = useJournalFilterStore();

  return useQuery({
    queryKey: ['journal', 'month', visibleMonth],
    queryFn: async () => {
      const anchor = new Date(visibleMonth);
      const start = toDateKey(startOfMonth(anchor));
      const end = toDateKey(endOfMonth(anchor));
      return listEntriesBetween(start, end);
    },
  });
}

/** Consecutive-day streak, computed from the trailing year of entries — enough
 * history for any realistic streak without scanning the whole journal. */
export function useJournalStreak() {
  return useQuery({
    queryKey: ['journal', 'streak'],
    queryFn: async () => {
      const end = toDateKey(new Date());
      const start = toDateKey(new Date(Date.now() - 366 * 24 * 60 * 60 * 1000));
      const entries = listEntriesBetween(start, end);
      return calculateJournalStreak(entries.map((entry) => entry.entryDate));
    },
  });
}

/**
 * Your own words from this date in earlier years.
 *
 * Kept fresh for the whole session rather than refetched on focus: the answer
 * changes at most once a day, and a card that re-renders while somebody is
 * reading a memory is the opposite of the point.
 */
export function useOnThisDay() {
  const today = toDateKey(new Date());

  return useQuery({
    queryKey: ['journal', 'on-this-day', today],
    staleTime: 60 * 60 * 1000,
    queryFn: async () => {
      const entries = listEntriesOnMonthDay(monthDay(today), yearOf(today));
      return onThisDay(entries, today);
    },
  });
}
