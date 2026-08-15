import { useQueryClient, useMutation } from '@tanstack/react-query';

import { cancelTaskReminder, syncTaskReminder } from '@/features/tasks/services/task-reminders';
import {
  archiveTask,
  completeTask,
  createTask,
  deleteTask,
  getTask,
  reopenTask,
  restoreTask,
  updateTask,
} from '@/features/tasks/services/tasks-repository';
import { useTasksFilterStore } from '@/features/tasks/store/tasks-filter-store';
import { reportError } from '@/lib/error-reporting';
import type {
  CreateTaskInput,
  Task,
  TaskStatus,
  UpdateTaskInput,
} from '@/features/tasks/types/task.types';

/**
 * Runs a reminder (re)schedule without letting it sink the mutation.
 *
 * Scheduling reaches the OS — permissions, channels, the pending-notification
 * ceiling — and every one of those can throw. When it did, the mutation
 * rejected *after* the row had already been written, so `onSuccess` never ran
 * and nothing was invalidated: the edit was saved and every list, detail screen
 * and widget went on showing the old value, which reads as "the app ignored
 * me". The write is the user's intent; the reminder is a best effort on top of
 * it, and the launch resync retries whatever failed here.
 */
async function withReminder(scope: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (error) {
    reportError(error, { scope });
  }
}

export function useTaskMutations() {
  const queryClient = useQueryClient();

  // The home-screen widget refreshes itself by watching the query cache
  // (features/widgets/hooks/use-widget-sync) — the feature no longer imports the
  // widget module, avoiding a features↔widgets dependency cycle.
  //
  // `dashboard` is invalidated alongside `tasks` because the dashboard's widgets
  // read the same tables under their own key namespace (see
  // features/dashboard/hooks/use-widget-data) — without this, editing a task's
  // due time left the Today card showing the old one.
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['tasks'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };

  /**
   * Optimistically flips a task's status so its checkbox fills instantly,
   * without waiting for the write + refetch. Targets the exact list query key
   * (['tasks', filter, sort]) so it can't corrupt detail/other list queries;
   * the settle invalidation re-filters the list (e.g. drops a now-completed
   * task out of the 'active' filter). Returns a rollback context for onError.
   */
  const optimisticStatus = async (
    taskId: string,
    status: TaskStatus,
    completedAt: number | null,
  ) => {
    const { filter, sort } = useTasksFilterStore.getState();
    const key = ['tasks', filter, sort] as const;
    await queryClient.cancelQueries({ queryKey: key });
    const previous = queryClient.getQueryData<Task[]>(key);
    queryClient.setQueryData<Task[]>(key, (old) =>
      old?.map((task) => (task.id === taskId ? { ...task, status, completedAt } : task)),
    );
    return { key, previous };
  };
  const rollback = (ctx?: { key: readonly unknown[]; previous: Task[] | undefined }) => {
    if (ctx) queryClient.setQueryData(ctx.key, ctx.previous);
  };

  const create = useMutation({
    mutationFn: async (input: CreateTaskInput) => {
      const task = createTask(input);
      await withReminder('task-reminder:create', () => syncTaskReminder(task));
      return task;
    },
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: async ({ id, input }: { id: string; input: UpdateTaskInput }) => {
      updateTask(id, input);
      const task = getTask(id);
      if (task) await withReminder('task-reminder:update', () => syncTaskReminder(task));
    },
    onSuccess: invalidate,
  });

  const complete = useMutation({
    mutationFn: async (id: string) => {
      const task = getTask(id);
      // A recurring task hands back the occurrence it just created; that clone
      // needs its own reminder scheduled here, or the series reminds once and
      // then never again (see completeTask).
      const nextOccurrence = completeTask(id);
      if (task) await withReminder('task-reminder:complete', () => cancelTaskReminder(task));
      if (nextOccurrence) {
        await withReminder('task-reminder:recurrence', () => syncTaskReminder(nextOccurrence));
      }
    },
    onMutate: (id) => optimisticStatus(id, 'completed', Date.now()),
    onError: (_e, _v, ctx) => rollback(ctx),
    onSettled: invalidate,
  });

  const reopen = useMutation({
    mutationFn: async (id: string) => {
      reopenTask(id);
      const task = getTask(id);
      if (task) await withReminder('task-reminder:reopen', () => syncTaskReminder(task));
    },
    onMutate: (id) => optimisticStatus(id, 'todo', null),
    onError: (_e, _v, ctx) => rollback(ctx),
    onSettled: invalidate,
  });

  const archive = useMutation({
    mutationFn: async (id: string) => {
      const task = getTask(id);
      archiveTask(id);
      if (task) await withReminder('task-reminder:archive', () => cancelTaskReminder(task));
    },
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const task = getTask(id);
      deleteTask(id);
      if (task) await withReminder('task-reminder:remove', () => cancelTaskReminder(task));
    },
    onSuccess: invalidate,
  });

  /** Puts back a task the user just deleted, from the undo toast. */
  const restore = useMutation({
    mutationFn: async (id: string) => {
      restoreTask(id);
      const task = getTask(id);
      if (task) await withReminder('task-reminder:restore', () => syncTaskReminder(task));
    },
    onSuccess: invalidate,
  });

  return { create, update, complete, reopen, archive, remove, restore };
}
