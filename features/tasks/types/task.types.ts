export type TaskStatus = 'todo' | 'in_progress' | 'completed' | 'archived';
export type TaskPriority = 'none' | 'low' | 'medium' | 'high';
export type TaskRecurrenceFrequency = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';

/** What the next occurrence of a repeating task counts from.
 *
 *  `due_date` is a fixed cadence — the weekly review happens on Mondays whether
 *  or not you did last Monday's. `completion` is an interval since you last did
 *  it, which is what chores actually are: watering the plants three days after
 *  the last watering, not three days after a date that has since passed twice. */
export type TaskRecurrenceAnchor = 'due_date' | 'completion';

export type TaskCategory = {
  id: string;
  name: string;
  colorToken: string;
  icon: string;
  deletedAt?: number | null;
};

export type Task = {
  id: string;
  title: string;
  notes: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  categoryId: string | null;
  dueDate: number | null;
  hasDueTime: boolean;
  recurrenceFrequency: TaskRecurrenceFrequency;
  /** "Every N" — 1 for every task that predates the richer rules. */
  recurrenceInterval: number;
  /** Weekly-on-chosen-days, 0 = Sunday. Null means plain "every N weeks".
   *  Stored as JSON text; the repository is the only place that sees the
   *  string form. */
  recurrenceDaysOfWeek: number[] | null;
  recurrenceAnchor: TaskRecurrenceAnchor;
  recurrenceParentId: string | null;
  completedAt: number | null;
  position: number;
  reminderEnabled: boolean;
  reminderNotificationId: string | null;
  /** Set when this task was created from a note via the note's "Create task" action. */
  sourceNoteId: string | null;
  /** The habit this task's completion logs, and the day it logs it for — both
   *  set together when the task is linked to a habit, and fixed at link time
   *  (not re-derived if the due date changes afterward). */
  habitId: string | null;
  habitLogDate: string | null;
  createdAt: number;
  updatedAt: number;
};

export type TaskDueBucket = 'overdue' | 'today' | 'upcoming' | 'no-date';

export type TaskListFilter = 'active' | 'completed' | 'archived';
export type TaskSort = 'due-date' | 'priority' | 'created';

export type CreateTaskInput = {
  title: string;
  notes?: string | null;
  priority?: TaskPriority;
  categoryId?: string | null;
  dueDate?: number | null;
  hasDueTime?: boolean;
  recurrenceFrequency?: TaskRecurrenceFrequency;
  recurrenceInterval?: number;
  recurrenceDaysOfWeek?: number[] | null;
  recurrenceAnchor?: TaskRecurrenceAnchor;
  /** Internal only — set by completeTask() when auto-cloning a recurring task. Not exposed in any picker UI. */
  recurrenceParentId?: string | null;
  reminderEnabled?: boolean;
  sourceNoteId?: string | null;
  habitId?: string | null;
  habitLogDate?: string | null;
};

export type UpdateTaskInput = Partial<CreateTaskInput> & {
  status?: TaskStatus;
};
