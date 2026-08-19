import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';

import { getDb } from '@/database/client';
import { taskSubtasks } from '@/database/schema';
import { checklistForNextOccurrence } from '@/features/tasks/services/subtask-progress';
import type { Subtask } from '@/features/tasks/types/task.types';
import { generateId } from '@/lib/id';
import { LOCAL_USER_ID } from '@/lib/local-user';

function toSubtask(row: typeof taskSubtasks.$inferSelect): Subtask {
  const { userId, deletedAt, ...rest } = row;
  return rest;
}

export function listSubtasks(taskId: string): Subtask[] {
  return getDb()
    .select()
    .from(taskSubtasks)
    .where(
      and(
        eq(taskSubtasks.userId, LOCAL_USER_ID),
        eq(taskSubtasks.taskId, taskId),
        isNull(taskSubtasks.deletedAt),
      ),
    )
    .orderBy(asc(taskSubtasks.position))
    .all()
    .map(toSubtask);
}

/**
 * Done and total per task, for the checklist badge on a task row.
 *
 * One grouped query rather than `listSubtasks` per row: a list of forty tasks
 * would otherwise open forty cursors on every render pass, which is the shape
 * that makes a list feel heavy long before it looks slow.
 */
export function getSubtaskCounts(
  taskIds: string[],
): Record<string, { done: number; total: number }> {
  if (taskIds.length === 0) return {};
  const rows = getDb()
    .select({
      taskId: taskSubtasks.taskId,
      total: sql<number>`count(*)`,
      done: sql<number>`sum(case when ${taskSubtasks.isDone} then 1 else 0 end)`,
    })
    .from(taskSubtasks)
    .where(
      and(
        eq(taskSubtasks.userId, LOCAL_USER_ID),
        inArray(taskSubtasks.taskId, taskIds),
        isNull(taskSubtasks.deletedAt),
      ),
    )
    .groupBy(taskSubtasks.taskId)
    .all();

  return Object.fromEntries(
    rows.map((row) => [row.taskId, { done: Number(row.done ?? 0), total: Number(row.total) }]),
  );
}

/** Appends to the end of the checklist. `position` counts deleted rows out, so
 *  removing an item does not leave the next one colliding with an existing
 *  position. */
export function createSubtask(taskId: string, title: string): Subtask {
  const now = Date.now();
  const existing = listSubtasks(taskId);
  const subtask: Subtask = {
    id: generateId(),
    taskId,
    title,
    isDone: false,
    completedAt: null,
    position: existing.length,
    createdAt: now,
    updatedAt: now,
  };
  getDb()
    .insert(taskSubtasks)
    .values({ ...subtask, userId: LOCAL_USER_ID })
    .run();
  return subtask;
}

export function setSubtaskDone(id: string, isDone: boolean) {
  const now = Date.now();
  getDb()
    .update(taskSubtasks)
    .set({ isDone, completedAt: isDone ? now : null, updatedAt: now })
    .where(eq(taskSubtasks.id, id))
    .run();
}

export function renameSubtask(id: string, title: string) {
  getDb()
    .update(taskSubtasks)
    .set({ title, updatedAt: Date.now() })
    .where(eq(taskSubtasks.id, id))
    .run();
}

/** Soft delete, and `updatedAt` moves with it — the sync push is
 *  `WHERE updated_at > cursor`, so a tombstone that did not bump it would never
 *  leave the device and the item would reappear from the next pull. */
export function deleteSubtask(id: string) {
  const now = Date.now();
  getDb()
    .update(taskSubtasks)
    .set({ deletedAt: now, updatedAt: now })
    .where(eq(taskSubtasks.id, id))
    .run();
}

export function reorderSubtasks(orderedIds: string[]) {
  const db = getDb();
  const now = Date.now();
  orderedIds.forEach((id, position) => {
    db.update(taskSubtasks).set({ position, updatedAt: now }).where(eq(taskSubtasks.id, id)).run();
  });
}

/**
 * Gives a repeating task's next occurrence its own copy of the checklist.
 *
 * Called by `completeTask` after it clones the task. Without it a recurring
 * task loses its checklist the first time it is ticked off — the user set the
 * list up once, saw it work, and found it empty on the occurrence that needed
 * it.
 */
export function copyChecklistToTask(fromTaskId: string, toTaskId: string) {
  const items = checklistForNextOccurrence(listSubtasks(fromTaskId));
  if (items.length === 0) return;
  const now = Date.now();
  getDb()
    .insert(taskSubtasks)
    .values(
      items.map((item) => ({
        id: generateId(),
        taskId: toTaskId,
        userId: LOCAL_USER_ID,
        title: item.title,
        isDone: false,
        completedAt: null,
        position: item.position,
        createdAt: now,
        updatedAt: now,
      })),
    )
    .run();
}

/** Removes a task's whole checklist, as tombstones. Called when the task itself
 *  is deleted: an orphaned checklist item syncs forever and belongs to nothing. */
export function deleteChecklistForTask(taskId: string) {
  const now = Date.now();
  getDb()
    .update(taskSubtasks)
    .set({ deletedAt: now, updatedAt: now })
    .where(and(eq(taskSubtasks.taskId, taskId), isNull(taskSubtasks.deletedAt)))
    .run();
}
