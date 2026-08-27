import { format } from 'date-fns/format';

/** Local-time 'yyyy-MM-dd' key used to index day-scoped rows (habit logs, journal entries). */
export function toDateKey(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}
