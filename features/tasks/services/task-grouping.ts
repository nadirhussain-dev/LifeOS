import { isPast } from 'date-fns/isPast';
import { isToday } from 'date-fns/isToday';
import { startOfDay } from 'date-fns/startOfDay';

import type { Task, TaskDueBucket } from '@/features/tasks/types/task.types';

/** i18n keys (see the `buckets` namespace) — the screen resolves them with t(). */
const BUCKET_LABEL_KEY: Record<TaskDueBucket, string> = {
  overdue: 'buckets.overdue',
  today: 'buckets.today',
  upcoming: 'buckets.upcoming',
  'no-date': 'buckets.noDate',
};

export function getDueBucket(task: Task): TaskDueBucket {
  if (!task.dueDate) return 'no-date';
  const due = new Date(task.dueDate);
  if (isToday(due)) return 'today';
  if (isPast(startOfDay(due))) return 'overdue';
  return 'upcoming';
}

export type TaskSection = { bucket: TaskDueBucket; labelKey: string; tasks: Task[] };

const BUCKET_ORDER: TaskDueBucket[] = ['overdue', 'today', 'upcoming', 'no-date'];

/** Groups tasks into due-date buckets, in a fixed display order, dropping empty buckets. */
export function groupTasksByDueDate(tasks: Task[]): TaskSection[] {
  const buckets = new Map<TaskDueBucket, Task[]>();
  for (const task of tasks) {
    const bucket = getDueBucket(task);
    buckets.set(bucket, [...(buckets.get(bucket) ?? []), task]);
  }
  return BUCKET_ORDER.filter((bucket) => buckets.has(bucket)).map((bucket) => ({
    bucket,
    labelKey: BUCKET_LABEL_KEY[bucket],
    tasks: buckets.get(bucket)!,
  }));
}
