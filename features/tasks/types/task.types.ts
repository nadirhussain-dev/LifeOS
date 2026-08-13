export type TaskStatus = 'todo' | 'in_progress' | 'completed' | 'archived';
export type TaskPriority = 'none' | 'low' | 'medium' | 'high';
export type TaskRecurrenceFrequency = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';

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
