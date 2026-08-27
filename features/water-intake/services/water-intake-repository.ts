import { addDays } from 'date-fns/addDays';
import { parseISO } from 'date-fns/parseISO';
import { and, eq, gte, isNull, lte } from 'drizzle-orm';

import { getDb } from '@/database/client';
import { waterIntakeLogs } from '@/database/schema';
import { generateId } from '@/lib/id';
import { toDateKey } from '@/lib/date';
import { LOCAL_USER_ID } from '@/lib/local-user';
import type {
  DailyWaterTotal,
  WaterIntakeLog,
} from '@/features/water-intake/types/water-intake.types';

function toLog(row: typeof waterIntakeLogs.$inferSelect): WaterIntakeLog {
  return { id: row.id, logDate: row.logDate, amountMl: row.amountMl, loggedAt: row.loggedAt };
}

/** Appends one "add water" action — never an upsert, so undo/history/Timeline
 * all read from the same real rows instead of a single mutable counter. */
export function logWater(
  amountMl: number,
  logDate: string = toDateKey(new Date()),
): WaterIntakeLog {
  const now = Date.now();
  const log: WaterIntakeLog = { id: generateId(), logDate, amountMl, loggedAt: now };
  getDb()
    .insert(waterIntakeLogs)
    .values({ ...log, userId: LOCAL_USER_ID, createdAt: now, updatedAt: now })
    .run();
  return log;
}

export function listLogsForDate(logDate: string): WaterIntakeLog[] {
  return getDb()
    .select()
    .from(waterIntakeLogs)
    .where(
      and(
        eq(waterIntakeLogs.userId, LOCAL_USER_ID),
        eq(waterIntakeLogs.logDate, logDate),
        isNull(waterIntakeLogs.deletedAt),
      ),
    )
    .orderBy(waterIntakeLogs.loggedAt)
    .all()
    .map(toLog);
}

export function getDailyTotal(logDate: string): number {
  return listLogsForDate(logDate).reduce((sum, log) => sum + log.amountMl, 0);
}

/** Removes the most recently logged entry for a day — the "undo" affordance,
 * since individual log amounts can vary (a glass vs. a bottle refill). */
export function undoLastLog(logDate: string = toDateKey(new Date())): void {
  const logs = listLogsForDate(logDate);
  const last = logs[logs.length - 1];
  if (!last) return;
  // Soft: a hard delete cannot sync — the glass would reappear on the next
  // pull from another device.
  const now = Date.now();
  getDb()
    .update(waterIntakeLogs)
    .set({ deletedAt: now, updatedAt: now })
    .where(eq(waterIntakeLogs.id, last.id))
    .run();
}

/** Inclusive date range, oldest first — missing days fill in as 0 so a
 * history chart/list always has one entry per day, not gaps. */
export function listDailyTotals(startDate: string, endDate: string): DailyWaterTotal[] {
  const rows = getDb()
    .select()
    .from(waterIntakeLogs)
    .where(
      and(
        eq(waterIntakeLogs.userId, LOCAL_USER_ID),
        gte(waterIntakeLogs.logDate, startDate),
        lte(waterIntakeLogs.logDate, endDate),
        isNull(waterIntakeLogs.deletedAt),
      ),
    )
    .all();

  const totalsByDate = new Map<string, number>();
  for (const row of rows)
    totalsByDate.set(row.logDate, (totalsByDate.get(row.logDate) ?? 0) + row.amountMl);

  const result: DailyWaterTotal[] = [];
  let cursor = parseISO(startDate);
  const end = parseISO(endDate);
  while (cursor <= end) {
    const key = toDateKey(cursor);
    result.push({ date: key, totalMl: totalsByDate.get(key) ?? 0 });
    cursor = addDays(cursor, 1);
  }
  return result;
}
