import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  createSubtask,
  deleteSubtask,
  getSubtaskCounts,
  listSubtasks,
  renameSubtask,
  reorderSubtasks,
  setSubtaskDone,
} from '@/features/tasks/services/subtasks-repository';
import type { Subtask } from '@/features/tasks/types/task.types';

export function useSubtasks(taskId: string | undefined) {
  return useQuery({
    queryKey: ['tasks', 'subtasks', taskId],
    queryFn: async () => (taskId ? listSubtasks(taskId) : []),
    enabled: !!taskId,
  });
}

/**
 * Checklist totals for a whole list of tasks, in one grouped query.
 *
 * Keyed on the task ids so it refetches when the list changes, and it shares
 * the `['tasks']` namespace so every existing mutation already invalidates it.
 */
export function useSubtaskCounts(taskIds: string[]) {
  return useQuery({
    queryKey: ['tasks', 'subtaskCounts', taskIds],
    queryFn: async () => getSubtaskCounts(taskIds),
    enabled: taskIds.length > 0,
    placeholderData: (previous) => previous,
  });
}

export function useSubtaskMutations(taskId: string | undefined) {
  const queryClient = useQueryClient();
  const key = ['tasks', 'subtasks', taskId];

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['tasks'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };

  /**
   * Ticking a checklist item is the highest-frequency action on this screen,
   * and the one where a refetch is most obvious: the box is under the user's
   * finger, so any delay between the tap and the fill reads as the app
   * hesitating. The cache is updated first and rolled back if the write fails.
   */
  const toggle = useMutation({
    mutationFn: async ({ id, isDone }: { id: string; isDone: boolean }) => {
      setSubtaskDone(id, isDone);
    },
    onMutate: async ({ id, isDone }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Subtask[]>(key);
      queryClient.setQueryData<Subtask[]>(key, (current) =>
        (current ?? []).map((subtask) =>
          subtask.id === id
            ? { ...subtask, isDone, completedAt: isDone ? Date.now() : null }
            : subtask,
        ),
      );
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },
    onSettled: invalidate,
  });

  const add = useMutation({
    mutationFn: async (title: string) => {
      if (!taskId) return;
      createSubtask(taskId, title);
    },
    onSuccess: invalidate,
  });

  const rename = useMutation({
    mutationFn: async ({ id, title }: { id: string; title: string }) => {
      renameSubtask(id, title);
    },
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      deleteSubtask(id);
    },
    onSuccess: invalidate,
  });

  const reorder = useMutation({
    mutationFn: async (orderedIds: string[]) => {
      reorderSubtasks(orderedIds);
    },
    onSuccess: invalidate,
  });

  return { toggle, add, rename, remove, reorder };
}
