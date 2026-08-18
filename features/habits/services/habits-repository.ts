import { and, eq, gte, inArray, isNull, lte } from 'drizzle-orm';

import { getDb } from '@/database/client';
import { habitLogContribution } from '@/features/goals/services/goal-contributions';
import { contributeToGoal } from '@/features/goals/services/goals-repository';
import {
  habitCategories,
  habitLogs,
  habitRoutineItems,
  habitRoutines,
  habits,
  habitSkips,
} from '@/database/schema';
import {
  calculateHabitStreaks,
  getTodayStatus,
  toDateKey,
} from '@/features/habits/services/habit-streaks';
import { generateId } from '@/lib/id';
import { LOCAL_USER_ID } from '@/lib/local-user';
import type {
  CreateHabitInput,
  Habit,
  HabitCategory,
  HabitLog,
  HabitRoutine,
  HabitSkip,
  HabitSkipReason,
  HabitWithToday,
  UpdateHabitInput,
} from '@/features/habits/types/habit.types';

function toHabit(row: typeof habits.$inferSelect): Habit {
  return {
    id: row.id,
    name: row.name,
    emoji: row.emoji,
    categoryId: row.categoryId,
    colorToken: row.colorToken,
    type: row.type,
    unit: row.unit,
    targetValue: row.targetValue,
    scheduleType: row.scheduleType,
    scheduleDays: row.scheduleDays ? (JSON.parse(row.scheduleDays) as number[]) : null,
    scheduleIntervalDays: row.scheduleIntervalDays,
    goalId: row.goalId,
    reminderTime: row.reminderTime,
    reminderAdaptive: row.reminderAdaptive,
    reminderNotificationId: row.reminderNotificationId,
    position: row.position,
    isArchived: row.isArchived,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function listHabits(includeArchived = false): Habit[] {
  const rows = getDb()
    .select()
    .from(habits)
    .where(and(eq(habits.userId, LOCAL_USER_ID), isNull(habits.deletedAt)))
    .orderBy(habits.position)
    .all();
  return rows.filter((row) => includeArchived || !row.isArchived).map(toHabit);
}

export function getHabit(id: string): Habit | null {
  const row = getDb().select().from(habits).where(eq(habits.id, id)).get();
  return row ? toHabit(row) : null;
}

/** Enriches a raw habit with today's derived status and streaks — shared by
 * the flat Today list and per-routine habit lookups so the calculation only
 * lives in one place. */
export function enrichHabitWithToday(habit: Habit, todayKey: string): HabitWithToday {
  const logs = listLogsForHabit(habit.id);
  const skips = listSkipsForHabit(habit.id);
  const { currentStreak, bestStreak } = calculateHabitStreaks(habit, logs, skips);
  const todayLog = logs.find((log) => log.logDate === todayKey);
  return {
    ...habit,
    todayStatus: getTodayStatus(habit, logs, skips, todayKey),
    todayValue: todayLog?.value ?? null,
    currentStreak,
    bestStreak,
  };
}

export function listHabitsWithToday(includeArchived = false): HabitWithToday[] {
  const todayKey = toDateKey(new Date());
  return listHabits(includeArchived).map((habit) => enrichHabitWithToday(habit, todayKey));
}

export function createHabit(input: CreateHabitInput): Habit {
  const now = Date.now();
  const habit: Habit = {
    id: generateId(),
    name: input.name,
    emoji: input.emoji ?? null,
    categoryId: input.categoryId ?? null,
    colorToken: input.colorToken ?? null,
    type: input.type,
    unit: input.unit ?? null,
    targetValue: input.targetValue ?? null,
    scheduleType: input.scheduleType,
    scheduleDays: input.scheduleDays ?? null,
    scheduleIntervalDays: input.scheduleIntervalDays ?? null,
    goalId: input.goalId ?? null,
    reminderTime: input.reminderTime ?? null,
    reminderAdaptive: input.reminderAdaptive ?? false,
    reminderNotificationId: null,
    position: 0,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
  };
  getDb()
    .insert(habits)
    .values({
      ...habit,
      scheduleDays: habit.scheduleDays ? JSON.stringify(habit.scheduleDays) : null,
      userId: LOCAL_USER_ID,
      syncStatus: 'pending',
    })
    .run();
  return habit;
}

export function updateHabit(id: string, input: UpdateHabitInput) {
  const { scheduleDays, ...rest } = input;
  getDb()
    .update(habits)
    .set({
      ...rest,
      ...(scheduleDays !== undefined
        ? { scheduleDays: scheduleDays ? JSON.stringify(scheduleDays) : null }
        : {}),
      updatedAt: Date.now(),
      syncStatus: 'pending',
    })
    .where(eq(habits.id, id))
    .run();
}

export function setHabitReminderNotificationId(id: string, notificationId: string | null) {
  getDb()
    .update(habits)
    .set({ reminderNotificationId: notificationId })
    .where(eq(habits.id, id))
    .run();
}

export function archiveHabit(id: string) {
  getDb()
    .update(habits)
    .set({ isArchived: true, updatedAt: Date.now(), syncStatus: 'pending' })
    .where(eq(habits.id, id))
    .run();
}

export function unarchiveHabit(id: string) {
  getDb()
    .update(habits)
    .set({ isArchived: false, updatedAt: Date.now(), syncStatus: 'pending' })
    .where(eq(habits.id, id))
    .run();
}

export function deleteHabit(id: string) {
  const db = getDb();
  db.update(habits)
    .set({ deletedAt: Date.now(), updatedAt: Date.now(), syncStatus: 'pending' })
    .where(eq(habits.id, id))
    .run();
  db.update(habitRoutineItems)
    .set({ deletedAt: Date.now(), updatedAt: Date.now() })
    .where(and(eq(habitRoutineItems.habitId, id), isNull(habitRoutineItems.deletedAt)))
    .run();
}

export function reorderHabits(orderedIds: string[]) {
  const db = getDb();
  orderedIds.forEach((id, index) => {
    db.update(habits).set({ position: index }).where(eq(habits.id, id)).run();
  });
}

export function listLogsForHabit(habitId: string): HabitLog[] {
  return getDb()
    .select()
    .from(habitLogs)
    .where(and(eq(habitLogs.habitId, habitId), isNull(habitLogs.deletedAt)))
    .all();
}

/** Every habit's logs across an inclusive date range, in one query — the
 * per-habit `listLogsForHabit` above can't answer "how many habits got done
 * on this day" across the whole set, which cross-module Insights needs. */
export function listAllHabitLogsBetween(startDate: string, endDate: string): HabitLog[] {
  return getDb()
    .select()
    .from(habitLogs)
    .where(
      and(
        eq(habitLogs.userId, LOCAL_USER_ID),
        isNull(habitLogs.deletedAt),
        gte(habitLogs.logDate, startDate),
        lte(habitLogs.logDate, endDate),
      ),
    )
    .all();
}

export function listSkipsForHabit(habitId: string): HabitSkip[] {
  return getDb()
    .select()
    .from(habitSkips)
    .where(and(eq(habitSkips.habitId, habitId), isNull(habitSkips.deletedAt)))
    .all();
}

/** Upserts a habit's log for a single day — idempotent so double-tapping
 * offline and syncing later never double-counts (unique on habit_id, log_date). */
export function logHabit(habitId: string, logDate: string, value = 1, note: string | null = null) {
  const db = getDb();
  const now = Date.now();
  const habit = getHabit(habitId);
  // Includes tombstones: re-ticking a day the user previously un-ticked has to
  // revive that row, not insert a second one alongside it.
  const existing = db
    .select()
    .from(habitLogs)
    .where(and(eq(habitLogs.habitId, habitId), eq(habitLogs.logDate, logDate)))
    .get();

  if (existing) {
    db.update(habitLogs)
      .set({ value, note, deletedAt: null, updatedAt: now })
      .where(eq(habitLogs.id, existing.id))
      .run();
    // The *change*, not the new value. This function is idempotent by design —
    // it revives a tombstone or overwrites a value rather than inserting a
    // second row — so a day already logged at 5 and corrected to 8 owes a
    // linked goal 3, not 8. A tombstone owes the whole amount, because its
    // contribution was taken back when it was deleted.
    contributeHabitLog(habit, existing.deletedAt === null ? existing.value : null, value, logDate);
    return;
  }

  db.insert(habitLogs)
    .values({
      id: generateId(),
      habitId,
      userId: LOCAL_USER_ID,
      logDate,
      value,
      note,
      loggedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  contributeHabitLog(habit, null, value, logDate);
}

/**
 * Passes a habit log's contribution to the goal the habit names, as the signed
 * difference between what the day counted for before and what it counts for
 * now.
 *
 * A habit and a task can both be linked to the same goal, and a task can also
 * be linked to that habit — in which case one tick contributes twice. That is
 * left as it is: both links were made explicitly, and silently ignoring one of
 * them would be the app deciding which of the user's two statements it believed.
 */
function contributeHabitLog(
  habit: Habit | null,
  previousValue: number | null,
  nextValue: number | null,
  logDate: string,
) {
  if (!habit?.goalId) return;
  const before = previousValue === null ? 0 : habitLogContribution(habit.type, previousValue);
  const after = nextValue === null ? 0 : habitLogContribution(habit.type, nextValue);
  contributeToGoal(habit.goalId, after - before, `${habit.name} · ${logDate}`);
}

/** Soft delete. A hard one cannot sync — the row would simply come back on the
 *  next pull from another device, silently re-ticking a habit the user cleared. */
export function unlogHabit(habitId: string, logDate: string) {
  const now = Date.now();
  const db = getDb();
  // Read before writing: once the tombstone is set there is no way to know what
  // the day counted for, and the goal is owed exactly that much back.
  const existing = db
    .select()
    .from(habitLogs)
    .where(and(eq(habitLogs.habitId, habitId), eq(habitLogs.logDate, logDate)))
    .get();

  db.update(habitLogs)
    .set({ deletedAt: now, updatedAt: now })
    .where(and(eq(habitLogs.habitId, habitId), eq(habitLogs.logDate, logDate)))
    .run();

  if (existing && existing.deletedAt === null) {
    contributeHabitLog(getHabit(habitId), existing.value, null, logDate);
  }
}

export function skipHabit(habitId: string, logDate: string, reason: HabitSkipReason) {
  const db = getDb();
  const now = Date.now();
  const existing = db
    .select()
    .from(habitSkips)
    .where(and(eq(habitSkips.habitId, habitId), eq(habitSkips.logDate, logDate)))
    .get();
  if (existing) {
    // Revives a previously-cleared skip rather than leaving the tombstone.
    if (existing.deletedAt !== null) {
      db.update(habitSkips)
        .set({ reason, deletedAt: null, updatedAt: now })
        .where(eq(habitSkips.id, existing.id))
        .run();
    }
    return;
  }

  db.insert(habitSkips)
    .values({
      id: generateId(),
      habitId,
      userId: LOCAL_USER_ID,
      logDate,
      reason,
      createdAt: now,
      updatedAt: now,
    })
    .run();
}

export function unskipHabit(habitId: string, logDate: string) {
  const now = Date.now();
  getDb()
    .update(habitSkips)
    .set({ deletedAt: now, updatedAt: now })
    .where(and(eq(habitSkips.habitId, habitId), eq(habitSkips.logDate, logDate)))
    .run();
}

function toCategory(row: typeof habitCategories.$inferSelect): HabitCategory {
  return { id: row.id, name: row.name, colorToken: row.colorToken, icon: row.icon };
}

export function listHabitCategories(): HabitCategory[] {
  return getDb()
    .select()
    .from(habitCategories)
    .where(and(eq(habitCategories.userId, LOCAL_USER_ID), isNull(habitCategories.deletedAt)))
    .all()
    .map(toCategory);
}

export function getHabitCategoryById(id: string): HabitCategory | null {
  const row = getDb().select().from(habitCategories).where(eq(habitCategories.id, id)).get();
  return row ? toCategory(row) : null;
}

export function createHabitCategory(name: string, colorToken: string, icon: string): HabitCategory {
  const now = Date.now();
  const category: HabitCategory = { id: generateId(), name, colorToken, icon };
  getDb()
    .insert(habitCategories)
    .values({ ...category, userId: LOCAL_USER_ID, createdAt: now, updatedAt: now })
    .run();
  return category;
}

export function deleteHabitCategory(id: string) {
  getDb()
    .update(habitCategories)
    .set({ deletedAt: Date.now(), updatedAt: Date.now() })
    .where(eq(habitCategories.id, id))
    .run();
}

// ---- Routines (habit stacking) ----

function toRoutine(row: typeof habitRoutines.$inferSelect): HabitRoutine {
  return { id: row.id, name: row.name, position: row.position };
}

export function listRoutines(): HabitRoutine[] {
  return getDb()
    .select()
    .from(habitRoutines)
    .where(and(eq(habitRoutines.userId, LOCAL_USER_ID), isNull(habitRoutines.deletedAt)))
    .orderBy(habitRoutines.position)
    .all()
    .map(toRoutine);
}

export function getRoutine(id: string): HabitRoutine | null {
  const row = getDb().select().from(habitRoutines).where(eq(habitRoutines.id, id)).get();
  return row ? toRoutine(row) : null;
}

export function createRoutine(name: string): HabitRoutine {
  const db = getDb();
  const now = Date.now();
  const maxPosition = db
    .select()
    .from(habitRoutines)
    .all()
    .reduce((max, row) => Math.max(max, row.position), -1);
  const routine: HabitRoutine = { id: generateId(), name, position: maxPosition + 1 };
  db.insert(habitRoutines)
    .values({ ...routine, userId: LOCAL_USER_ID, createdAt: now, updatedAt: now })
    .run();
  return routine;
}

export function renameRoutine(id: string, name: string) {
  getDb()
    .update(habitRoutines)
    .set({ name, updatedAt: Date.now() })
    .where(eq(habitRoutines.id, id))
    .run();
}

export function deleteRoutine(id: string) {
  const db = getDb();
  db.update(habitRoutines)
    .set({ deletedAt: Date.now(), updatedAt: Date.now() })
    .where(eq(habitRoutines.id, id))
    .run();
  // Soft, like the routine itself: routine items sync now, and a hard DELETE
  // leaves nothing for the engine to push, so the next pull would put every
  // item back.
  db.update(habitRoutineItems)
    .set({ deletedAt: Date.now(), updatedAt: Date.now() })
    .where(and(eq(habitRoutineItems.routineId, id), isNull(habitRoutineItems.deletedAt)))
    .run();
}

/** Ordered habit ids for one routine. */
export function listRoutineHabitIds(routineId: string): string[] {
  return getDb()
    .select()
    .from(habitRoutineItems)
    .where(and(eq(habitRoutineItems.routineId, routineId), isNull(habitRoutineItems.deletedAt)))
    .orderBy(habitRoutineItems.position)
    .all()
    .map((row) => row.habitId);
}

/** Every habit id that belongs to any routine — used to split the Today
 * list into "in a routine" vs. "standalone, grouped by category." */
export function listRoutinedHabitIds(): Set<string> {
  return new Set(
    getDb()
      .select()
      .from(habitRoutineItems)
      .where(isNull(habitRoutineItems.deletedAt))
      .all()
      .map((row) => row.habitId),
  );
}

export function addHabitToRoutine(routineId: string, habitId: string) {
  const db = getDb();
  const now = Date.now();
  const existing = db
    .select()
    .from(habitRoutineItems)
    .where(and(eq(habitRoutineItems.routineId, routineId), eq(habitRoutineItems.habitId, habitId)))
    .get();

  // A row may exist but be soft-deleted from an earlier removal. Reviving it
  // keeps the derived id — and therefore the server row — stable.
  if (existing) {
    if (existing.deletedAt === null) return;
    db.update(habitRoutineItems)
      .set({ deletedAt: null, updatedAt: now })
      .where(
        and(eq(habitRoutineItems.routineId, routineId), eq(habitRoutineItems.habitId, habitId)),
      )
      .run();
    return;
  }

  const maxPosition = db
    .select()
    .from(habitRoutineItems)
    .where(and(eq(habitRoutineItems.routineId, routineId), isNull(habitRoutineItems.deletedAt)))
    .all()
    .reduce((max, row) => Math.max(max, row.position), -1);
  db.insert(habitRoutineItems)
    .values({
      id: `${routineId}:${habitId}`,
      userId: LOCAL_USER_ID,
      routineId,
      habitId,
      position: maxPosition + 1,
      updatedAt: now,
    })
    .run();
}

export function removeHabitFromRoutine(routineId: string, habitId: string) {
  const now = Date.now();
  getDb()
    .update(habitRoutineItems)
    .set({ deletedAt: now, updatedAt: now })
    .where(and(eq(habitRoutineItems.routineId, routineId), eq(habitRoutineItems.habitId, habitId)))
    .run();
}

export function reorderRoutineHabits(routineId: string, orderedHabitIds: string[]) {
  const db = getDb();
  const now = Date.now();
  orderedHabitIds.forEach((habitId, index) => {
    db.update(habitRoutineItems)
      .set({ position: index, updatedAt: now })
      .where(
        and(eq(habitRoutineItems.routineId, routineId), eq(habitRoutineItems.habitId, habitId)),
      )
      .run();
  });
}

export function getHabitsByIds(ids: string[]): Habit[] {
  if (ids.length === 0) return [];
  const rows = getDb().select().from(habits).where(inArray(habits.id, ids)).all();
  return rows.map(toHabit);
}
