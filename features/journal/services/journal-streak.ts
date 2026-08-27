import { subDays } from 'date-fns/subDays';

import { toDateKey } from '@/lib/date';

/**
 * Consecutive days (ending today or yesterday) with a journal entry.
 * Today not having an entry yet doesn't break the streak — same "today
 * hasn't happened yet" leniency as habit streaks.
 */
export function calculateJournalStreak(entryDates: string[], asOf: Date = new Date()): number {
  const dates = new Set(entryDates);
  let streak = 0;
  let cursor = asOf;
  let isToday = true;

  for (let i = 0; i < 3650; i += 1) {
    const key = toDateKey(cursor);
    if (dates.has(key)) {
      streak += 1;
    } else if (!isToday) {
      break;
    }
    isToday = false;
    cursor = subDays(cursor, 1);
  }

  return streak;
}
