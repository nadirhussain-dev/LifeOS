import { format } from 'date-fns';
import { and, eq, isNull } from 'drizzle-orm';

import { getDb } from '@/database/client';
import {
  applyContribution,
  canGoalReceiveContributions,
} from '@/features/goals/services/goal-contributions';
import { goalMilestones, goalProgressLogs, goals } from '@/database/schema';
import { computeGoalProgress } from '@/features/goals/services/goal-progress';
import { generateId } from '@/lib/id';
import { LOCAL_USER_ID } from '@/lib/local-user';
import type {
  CreateGoalInput,
  Goal,
  GoalMilestone,
  GoalProgressLog,
  GoalStatus,
  GoalWithProgress,
  UpdateGoalInput,
} from '@/features/goals/types/goal.types';

function toGoal(row: typeof goals.$inferSelect): Goal {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category,
    categoryLabel: row.categoryLabel,
    priority: row.priority,
    status: row.status,
    progressMode: row.progressMode,
    manualProgress: row.manualProgress,
    targetValue: row.targetValue,
    currentValue: row.currentValue,
    unit: row.unit,
    dueDate: row.dueDate,
    completedAt: row.completedAt,
    position: row.position,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toMilestone(row: typeof goalMilestones.$inferSelect): GoalMilestone {
  return {
    id: row.id,
    goalId: row.goalId,
    title: row.title,
    isCompleted: row.isCompleted,
    completedAt: row.completedAt,
    position: row.position,
    createdAt: row.createdAt,
  };
}

export function listMilestones(goalId: string): GoalMilestone[] {
  return getDb()
    .select()
    .from(goalMilestones)
    .where(and(eq(goalMilestones.goalId, goalId), isNull(goalMilestones.deletedAt)))
    .orderBy(goalMilestones.position)
    .all()
    .map(toMilestone);
}

/** Enriches a goal with its computed progress and milestone rollup. Milestones
 * are fetched once here so the list can pass them through without every card
 * issuing its own query. */
export function enrichGoal(goal: Goal, milestones?: GoalMilestone[]): GoalWithProgress {
  const ms = milestones ?? (goal.progressMode === 'milestones' ? listMilestones(goal.id) : []);
  return {
    ...goal,
    progress: computeGoalProgress(goal, ms),
    milestoneTotal: ms.length,
    milestoneDone: ms.filter((m) => m.isCompleted).length,
  };
}

export function listGoals(status?: GoalStatus): GoalWithProgress[] {
  const rows = getDb()
    .select()
    .from(goals)
    .where(and(eq(goals.userId, LOCAL_USER_ID), isNull(goals.deletedAt)))
    .orderBy(goals.position)
    .all()
    .map(toGoal);

  // One pass to collect milestones for milestone-mode goals rather than N
  // queries inside enrichGoal — keeps the list query flat and predictable.
  const milestonesByGoal = new Map<string, GoalMilestone[]>();
  const milestoneGoalIds = rows.filter((g) => g.progressMode === 'milestones').map((g) => g.id);
  if (milestoneGoalIds.length > 0) {
    const allMilestones = getDb()
      .select()
      .from(goalMilestones)
      .where(isNull(goalMilestones.deletedAt))
      .all()
      .map(toMilestone);
    for (const milestone of allMilestones) {
      if (!milestonesByGoal.has(milestone.goalId)) milestonesByGoal.set(milestone.goalId, []);
      milestonesByGoal.get(milestone.goalId)!.push(milestone);
    }
  }

  return rows
    .filter((goal) => !status || goal.status === status)
    .map((goal) =>
      enrichGoal(
        goal,
        goal.progressMode === 'milestones'
          ? (milestonesByGoal.get(goal.id) ?? []).sort((a, b) => a.position - b.position)
          : [],
      ),
    );
}

export function getGoal(id: string): GoalWithProgress | null {
  const row = getDb().select().from(goals).where(eq(goals.id, id)).get();
  if (!row) return null;
  const goal = toGoal(row);
  return enrichGoal(goal, listMilestones(id));
}

export function createGoal(input: CreateGoalInput): Goal {
  const db = getDb();
  const now = Date.now();
  const maxPosition = db
    .select()
    .from(goals)
    .where(eq(goals.userId, LOCAL_USER_ID))
    .all()
    .reduce((max, row) => Math.max(max, row.position), -1);

  const id = generateId();
  const goal: Goal = {
    id,
    title: input.title,
    description: input.description ?? null,
    category: input.category,
    categoryLabel: input.categoryLabel ?? null,
    priority: input.priority,
    status: 'active',
    progressMode: input.progressMode,
    manualProgress: input.manualProgress ?? 0,
    targetValue: input.targetValue ?? null,
    currentValue: input.currentValue ?? 0,
    unit: input.unit ?? null,
    dueDate: input.dueDate ?? null,
    completedAt: null,
    position: maxPosition + 1,
    createdAt: now,
    updatedAt: now,
  };

  db.insert(goals)
    .values({ ...goal, userId: LOCAL_USER_ID, syncStatus: 'pending' })
    .run();

  input.milestones
    ?.map((title) => title.trim())
    .filter(Boolean)
    .forEach((title, index) => {
      db.insert(goalMilestones)
        .values({
          id: generateId(),
          goalId: id,
          userId: LOCAL_USER_ID,
          title,
          position: index,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    });

  return goal;
}

export function updateGoal(id: string, input: UpdateGoalInput) {
  getDb()
    .update(goals)
    .set({ ...input, updatedAt: Date.now(), syncStatus: 'pending' })
    .where(eq(goals.id, id))
    .run();
}

export function setGoalManualProgress(id: string, progress: number) {
  getDb()
    .update(goals)
    .set({
      manualProgress: Math.max(0, Math.min(1, progress)),
      updatedAt: Date.now(),
      syncStatus: 'pending',
    })
    .where(eq(goals.id, id))
    .run();
}

export function setGoalCurrentValue(id: string, currentValue: number) {
  getDb()
    .update(goals)
    .set({ currentValue: Math.max(0, currentValue), updatedAt: Date.now(), syncStatus: 'pending' })
    .where(eq(goals.id, id))
    .run();
}

export function completeGoal(id: string) {
  const now = Date.now();
  getDb()
    .update(goals)
    .set({ status: 'completed', completedAt: now, updatedAt: now, syncStatus: 'pending' })
    .where(eq(goals.id, id))
    .run();
}

export function reopenGoal(id: string) {
  getDb()
    .update(goals)
    .set({ status: 'active', completedAt: null, updatedAt: Date.now(), syncStatus: 'pending' })
    .where(eq(goals.id, id))
    .run();
}

export function archiveGoal(id: string) {
  getDb()
    .update(goals)
    .set({ status: 'archived', updatedAt: Date.now(), syncStatus: 'pending' })
    .where(eq(goals.id, id))
    .run();
}

export function deleteGoal(id: string) {
  const db = getDb();
  db.update(goals)
    .set({ deletedAt: Date.now(), updatedAt: Date.now(), syncStatus: 'pending' })
    .where(eq(goals.id, id))
    .run();
  // Soft, like the goal itself: hard deletes cannot sync, and the children
  // would be resurrected by the next pull from another device.
  const deletedAt = Date.now();
  db.update(goalMilestones)
    .set({ deletedAt, updatedAt: deletedAt })
    .where(eq(goalMilestones.goalId, id))
    .run();
  db.update(goalProgressLogs)
    .set({ deletedAt, updatedAt: deletedAt })
    .where(eq(goalProgressLogs.goalId, id))
    .run();
}

// ---- Milestones ----

export function addMilestone(goalId: string, title: string): GoalMilestone {
  const db = getDb();
  const now = Date.now();
  const maxPosition = db
    .select()
    .from(goalMilestones)
    .where(and(eq(goalMilestones.goalId, goalId), isNull(goalMilestones.deletedAt)))
    .all()
    .reduce((max, row) => Math.max(max, row.position), -1);
  const milestone: GoalMilestone = {
    id: generateId(),
    goalId,
    title: title.trim(),
    isCompleted: false,
    completedAt: null,
    position: maxPosition + 1,
    createdAt: now,
  };
  db.insert(goalMilestones)
    .values({ ...milestone, userId: LOCAL_USER_ID, updatedAt: now })
    .run();
  return milestone;
}

// ---- Progress logs ----

function toProgressLog(row: typeof goalProgressLogs.$inferSelect): GoalProgressLog {
  return {
    id: row.id,
    goalId: row.goalId,
    value: row.value,
    delta: row.delta,
    note: row.note,
    loggedAt: row.loggedAt,
    logDate: row.logDate,
    createdAt: row.createdAt,
  };
}

export function listProgressLogs(goalId: string): GoalProgressLog[] {
  return getDb()
    .select()
    .from(goalProgressLogs)
    .where(and(eq(goalProgressLogs.goalId, goalId), isNull(goalProgressLogs.deletedAt)))
    .orderBy(goalProgressLogs.loggedAt)
    .all()
    .map(toProgressLog);
}

/**
 * Records a progress update: appends an immutable log row AND advances the
 * goal's live value in the same call so the two never drift. `resultingValue`
 * is in the goal's native scale (fraction for percent goals, absolute count for
 * count goals); `delta` is the signed change for the activity feed.
 */
export function logGoalProgress(
  goal: Goal,
  resultingValue: number,
  delta: number,
  note: string | null,
): GoalProgressLog {
  const db = getDb();
  const now = Date.now();
  const log: GoalProgressLog = {
    id: generateId(),
    goalId: goal.id,
    value: resultingValue,
    delta,
    note: note?.trim() || null,
    loggedAt: now,
    logDate: format(now, 'yyyy-MM-dd'),
    createdAt: now,
  };
  db.insert(goalProgressLogs)
    .values({ ...log, userId: LOCAL_USER_ID, updatedAt: now })
    .run();

  if (goal.progressMode === 'count') {
    db.update(goals)
      .set({ currentValue: Math.max(0, resultingValue), updatedAt: now, syncStatus: 'pending' })
      .where(eq(goals.id, goal.id))
      .run();
  } else {
    db.update(goals)
      .set({
        manualProgress: Math.max(0, Math.min(1, resultingValue)),
        updatedAt: now,
        syncStatus: 'pending',
      })
      .where(eq(goals.id, goal.id))
      .run();
  }
  return log;
}

/**
 * Advances a goal because linked work was finished, or reverses it because the
 * work was undone.
 *
 * Silent when the goal is gone, soft-deleted, or not a count goal. That is
 * deliberate rather than lax: a task can outlive the goal it named, and the
 * alternative — throwing from inside `completeTask` — would mean a tick that
 * refuses to register because of a goal the user deleted weeks ago.
 */
export function contributeToGoal(goalId: string, requestedDelta: number, note: string | null) {
  const goal = getGoal(goalId);
  if (!goal || !canGoalReceiveContributions(goal)) return;

  const { value, delta } = applyContribution(goal, requestedDelta);
  if (delta === 0) return;

  logGoalProgress(goal, value, delta, note);
}

export function deleteProgressLog(id: string) {
  const now = Date.now();
  getDb()
    .update(goalProgressLogs)
    .set({ deletedAt: now, updatedAt: now })
    .where(eq(goalProgressLogs.id, id))
    .run();
}

export function toggleMilestone(id: string, isCompleted: boolean) {
  const now = Date.now();
  getDb()
    .update(goalMilestones)
    .set({ isCompleted, completedAt: isCompleted ? now : null, updatedAt: now })
    .where(eq(goalMilestones.id, id))
    .run();
}

export function renameMilestone(id: string, title: string) {
  getDb()
    .update(goalMilestones)
    .set({ title: title.trim(), updatedAt: Date.now() })
    .where(eq(goalMilestones.id, id))
    .run();
}

export function deleteMilestone(id: string) {
  const now = Date.now();
  getDb()
    .update(goalMilestones)
    .set({ deletedAt: now, updatedAt: now })
    .where(eq(goalMilestones.id, id))
    .run();
}
