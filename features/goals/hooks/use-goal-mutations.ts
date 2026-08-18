import { useMutation, useQueryClient } from '@tanstack/react-query';

import {
  addMilestone,
  archiveGoal,
  completeGoal,
  createGoal,
  deleteGoal,
  deleteMilestone,
  deleteProgressLog,
  logGoalProgress,
  renameMilestone,
  reopenGoal,
  setGoalCurrentValue,
  setGoalManualProgress,
  toggleMilestone,
  updateGoal,
} from '@/features/goals/services/goals-repository';
import type {
  CreateGoalInput,
  Goal,
  GoalMilestone,
  UpdateGoalInput,
} from '@/features/goals/types/goal.types';

export function useGoalMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['goals'] });

  const create = useMutation({
    mutationFn: async (input: CreateGoalInput) => createGoal(input),
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: async ({ id, input }: { id: string; input: UpdateGoalInput }) =>
      updateGoal(id, input),
    onSuccess: invalidate,
  });

  const setProgress = useMutation({
    mutationFn: async ({ id, progress }: { id: string; progress: number }) =>
      setGoalManualProgress(id, progress),
    onSuccess: invalidate,
  });

  const setCurrentValue = useMutation({
    mutationFn: async ({ id, value }: { id: string; value: number }) =>
      setGoalCurrentValue(id, value),
    onSuccess: invalidate,
  });

  /** Records a dated progress check-in and advances the goal's value. */
  const logProgress = useMutation({
    mutationFn: async ({
      goal,
      resultingValue,
      delta,
      note,
    }: {
      goal: Goal;
      resultingValue: number;
      delta: number;
      note?: string | null;
    }) => logGoalProgress(goal, resultingValue, delta, note ?? null),
    onSuccess: invalidate,
  });

  const removeProgressLog = useMutation({
    mutationFn: async (id: string) => deleteProgressLog(id),
    onSuccess: invalidate,
  });

  const complete = useMutation({
    mutationFn: async (id: string) => completeGoal(id),
    onSuccess: invalidate,
  });

  const reopen = useMutation({
    mutationFn: async (id: string) => reopenGoal(id),
    onSuccess: invalidate,
  });

  const archive = useMutation({
    mutationFn: async (id: string) => archiveGoal(id),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => deleteGoal(id),
    onSuccess: invalidate,
  });

  const addMilestoneMutation = useMutation({
    mutationFn: async ({ goalId, title }: { goalId: string; title: string }) =>
      addMilestone(goalId, title),
    onSuccess: invalidate,
  });

  /**
   * Ticks the milestone before the write lands.
   *
   * Same reasoning as the task checklist: the box is under the user's finger,
   * so any gap between the tap and the fill reads as the app hesitating. The
   * mutation is given only the milestone id, so this patches by id across the
   * `milestones` caches rather than needing the goal it belongs to.
   *
   * `completedAt` is set here too, not just the flag — the row's own subtitle
   * renders from it, so patching one and not the other would tick the box and
   * leave "not yet completed" beside it.
   */
  const toggleMilestoneMutation = useMutation({
    mutationFn: async ({ id, isCompleted }: { id: string; isCompleted: boolean }) =>
      toggleMilestone(id, isCompleted),
    onMutate: async ({ id, isCompleted }) => {
      const key = ['goals', 'milestones'];
      await queryClient.cancelQueries({ queryKey: key });
      const snapshot = queryClient.getQueriesData<GoalMilestone[]>({ queryKey: key });

      queryClient.setQueriesData<GoalMilestone[]>({ queryKey: key }, (current) =>
        (current ?? []).map((milestone) =>
          milestone.id === id
            ? { ...milestone, isCompleted, completedAt: isCompleted ? Date.now() : null }
            : milestone,
        ),
      );

      return { snapshot };
    },
    onError: (_error, _variables, context) => {
      for (const [key, data] of context?.snapshot ?? []) {
        queryClient.setQueryData(key, data);
      }
    },
    onSettled: invalidate,
  });

  const renameMilestoneMutation = useMutation({
    mutationFn: async ({ id, title }: { id: string; title: string }) => renameMilestone(id, title),
    onSuccess: invalidate,
  });

  const removeMilestoneMutation = useMutation({
    mutationFn: async (id: string) => deleteMilestone(id),
    onSuccess: invalidate,
  });

  return {
    create,
    update,
    setProgress,
    setCurrentValue,
    logProgress,
    removeProgressLog,
    complete,
    reopen,
    archive,
    remove,
    addMilestone: addMilestoneMutation,
    toggleMilestone: toggleMilestoneMutation,
    renameMilestone: renameMilestoneMutation,
    removeMilestone: removeMilestoneMutation,
  };
}
