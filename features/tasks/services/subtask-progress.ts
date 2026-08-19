import type { Subtask } from '@/features/tasks/types/task.types';

/**
 * How far through a checklist a task is.
 *
 * `ratio` is 0 for an empty checklist rather than 1. Both are arguable — a
 * checklist with nothing on it is vacuously complete — but the value drives a
 * progress bar, and a task with no subtasks rendering as a full bar reads as
 * "done" on a list of things that are not.
 */
export function subtaskProgress(subtasks: Subtask[]): {
  done: number;
  total: number;
  ratio: number;
} {
  const total = subtasks.length;
  const done = subtasks.filter((subtask) => subtask.isDone).length;
  return { done, total, ratio: total === 0 ? 0 : done / total };
}

/**
 * The checklist a repeating task's next occurrence starts with.
 *
 * A recurring task that loses its checklist the first time it is ticked off is
 * worse than one that never had it: the user set the list up once, watched it
 * work, and then found it silently empty on the occurrence that actually needed
 * it. So the items are carried onto the clone — unticked, because the point of
 * the next occurrence is that the work has to be done again, and with their
 * ordering preserved so the list reads the same way it did when it was written.
 *
 * Returns the fields that describe the *content* of each item. Ids, the new
 * task id and timestamps belong to the caller, which is the only thing holding
 * the transaction.
 */
export function checklistForNextOccurrence(
  subtasks: Subtask[],
): { title: string; position: number }[] {
  return [...subtasks]
    .sort((a, b) => a.position - b.position)
    .map((subtask, index) => ({ title: subtask.title, position: index }));
}
