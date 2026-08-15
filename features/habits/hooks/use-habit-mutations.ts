import { useQueryClient, useMutation } from '@tanstack/react-query';

import { cancelHabitReminder, syncHabitReminder } from '@/features/habits/services/habit-reminders';
import { toDateKey } from '@/features/habits/services/habit-streaks';
import {
  archiveHabit,
  createHabit,
  deleteHabit,
  getHabit,
  logHabit,
  reorderHabits,
  skipHabit,
  unarchiveHabit,
  unlogHabit,
  unskipHabit,
  updateHabit,
} from '@/features/habits/services/habits-repository';
import { useHabitsFilterStore } from '@/features/habits/store/habits-filter-store';
import type {
  CreateHabitInput,
  HabitSkipReason,
  HabitTodayStatus,
  HabitWithToday,
  UpdateHabitInput,
} from '@/features/habits/types/habit.types';

export function useHabitMutations() {
  const queryClient = useQueryClient();

  // Widget refresh happens via the query-cache subscription (use-widget-sync);
  // the feature no longer imports the widget module (avoids a dependency cycle).
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['habits'] });

  /**
   * Optimistically flips a habit's today-status so the checkbox animates
   * instantly, without waiting for the write + refetch. Targets the exact list
   * query key (['habits', showArchived]) — not the ['habits'] prefix — so it
   * can't corrupt other habit queries. Returns a rollback context for onError.
   */
  const optimisticStatus = async (habitId: string, status: HabitTodayStatus) => {
    const key = ['habits', useHabitsFilterStore.getState().showArchived] as const;
    await queryClient.cancelQueries({ queryKey: key });
    const previous = queryClient.getQueryData<HabitWithToday[]>(key);
    queryClient.setQueryData<HabitWithToday[]>(key, (old) =>
      old?.map((habit) => (habit.id === habitId ? { ...habit, todayStatus: status } : habit)),
    );
    return { key, previous };
  };
  const rollback = (ctx?: { key: readonly unknown[]; previous: HabitWithToday[] | undefined }) => {
    if (ctx) queryClient.setQueryData(ctx.key, ctx.previous);
  };

  const create = useMutation({
    mutationFn: async (input: CreateHabitInput) => {
      const habit = createHabit(input);
      await syncHabitReminder(habit);
      return habit;
    },
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: async ({ id, input }: { id: string; input: UpdateHabitInput }) => {
      updateHabit(id, input);
      const habit = getHabit(id);
      if (habit) await syncHabitReminder(habit);
    },
    onSuccess: invalidate,
  });

  const archive = useMutation({
    mutationFn: async (id: string) => {
      const habit = getHabit(id);
      archiveHabit(id);
      if (habit) await cancelHabitReminder(habit);
    },
    onSuccess: invalidate,
  });

  /** Un-archiving has to put the reminder back: `archive` cancelled it, and the
   *  habit's own reminder time still says it should be firing. Without this it
   *  stayed silent until some later launch happened to run the rebuild. */
  const unarchive = useMutation({
    mutationFn: async (id: string) => {
      unarchiveHabit(id);
      const habit = getHabit(id);
      if (habit) await syncHabitReminder(habit);
    },
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const habit = getHabit(id);
      deleteHabit(id);
      if (habit) await cancelHabitReminder(habit);
    },
    onSuccess: invalidate,
  });

  const reorder = useMutation({
    mutationFn: async (orderedIds: string[]) => reorderHabits(orderedIds),
    onSuccess: invalidate,
  });

  const logToday = useMutation({
    mutationFn: async ({ habitId, value }: { habitId: string; value?: number }) =>
      logHabit(habitId, toDateKey(new Date()), value ?? 1),
    onMutate: ({ habitId }) => optimisticStatus(habitId, 'done'),
    onError: (_e, _v, ctx) => rollback(ctx),
    onSettled: invalidate,
  });

  const unlogToday = useMutation({
    mutationFn: async (habitId: string) => unlogHabit(habitId, toDateKey(new Date())),
    onMutate: (habitId) => optimisticStatus(habitId, 'not_yet'),
    onError: (_e, _v, ctx) => rollback(ctx),
    onSettled: invalidate,
  });

  const logDate = useMutation({
    mutationFn: async ({
      habitId,
      logDate,
      value,
    }: {
      habitId: string;
      logDate: string;
      value?: number;
    }) => logHabit(habitId, logDate, value ?? 1),
    onSuccess: invalidate,
  });

  const skipToday = useMutation({
    mutationFn: async ({ habitId, reason }: { habitId: string; reason: HabitSkipReason }) =>
      skipHabit(habitId, toDateKey(new Date()), reason),
    onSuccess: invalidate,
  });

  const unskipToday = useMutation({
    mutationFn: async (habitId: string) => unskipHabit(habitId, toDateKey(new Date())),
    onSuccess: invalidate,
  });

  return {
    create,
    update,
    archive,
    unarchive,
    remove,
    reorder,
    logToday,
    unlogToday,
    logDate,
    skipToday,
    unskipToday,
  };
}
