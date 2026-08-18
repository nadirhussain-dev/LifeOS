import { useQuery } from '@tanstack/react-query';

import { canGoalReceiveContributions } from '@/features/goals/services/goal-contributions';

import { PRIORITY_RANK } from '@/features/goals/config/goal-priority';
import {
  getGoal,
  listGoals,
  listMilestones,
  listProgressLogs,
} from '@/features/goals/services/goals-repository';
import { useGoalsFilterStore } from '@/features/goals/store/goals-filter-store';
import type { GoalWithProgress } from '@/features/goals/types/goal.types';

function sortGoals(
  goals: GoalWithProgress[],
  sort: ReturnType<typeof useGoalsFilterStore.getState>['sort'],
): GoalWithProgress[] {
  const copy = [...goals];
  switch (sort) {
    case 'progress':
      return copy.sort((a, b) => b.progress - a.progress);
    case 'due':
      // Goals with a due date first (soonest → latest), undated goals last.
      return copy.sort((a, b) => (a.dueDate ?? Infinity) - (b.dueDate ?? Infinity));
    case 'priority':
      return copy.sort((a, b) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority]);
    case 'created':
      return copy.sort((a, b) => b.createdAt - a.createdAt);
    case 'manual':
    default:
      return copy.sort((a, b) => a.position - b.position);
  }
}

/**
 * Active goals a task or habit can be linked to.
 *
 * Separate from `useGoals`, which is driven by the goals screen's filter store —
 * a picker on the task screen must not change what it offers because the user
 * last left the goals list filtered to "archived".
 */
export function useLinkableGoals() {
  return useQuery({
    queryKey: ['goals', 'linkable'],
    queryFn: async () => listGoals('active').filter(canGoalReceiveContributions),
  });
}

export function useGoals() {
  const { searchQuery, statusFilter, categoryFilter, sort } = useGoalsFilterStore();

  return useQuery({
    queryKey: ['goals', statusFilter],
    queryFn: async () => listGoals(statusFilter),
    select: (goals) => {
      const query = searchQuery.trim().toLowerCase();
      const filtered = goals.filter((goal) => {
        if (categoryFilter !== 'all' && goal.category !== categoryFilter) return false;
        if (
          query &&
          !goal.title.toLowerCase().includes(query) &&
          !(goal.description ?? '').toLowerCase().includes(query)
        ) {
          return false;
        }
        return true;
      });
      return sortGoals(filtered, sort);
    },
  });
}

/** Cross-status counts for the dashboard header — independent of the active
 * status filter so the tallies stay stable as the user switches tabs. */
export function useGoalStats() {
  return useQuery({
    queryKey: ['goals', 'stats'],
    queryFn: async () => {
      const active = listGoals('active');
      const completed = listGoals('completed');
      const avgProgress = active.length
        ? active.reduce((sum, goal) => sum + goal.progress, 0) / active.length
        : 0;
      const nextDue =
        active.filter((goal) => goal.dueDate).sort((a, b) => (a.dueDate ?? 0) - (b.dueDate ?? 0))[0]
          ?.dueDate ?? null;
      return { activeCount: active.length, completedCount: completed.length, avgProgress, nextDue };
    },
  });
}

export function useGoal(id: string | undefined) {
  return useQuery({
    queryKey: ['goals', 'detail', id],
    queryFn: async () => (id ? getGoal(id) : null),
    enabled: !!id,
  });
}

export function useGoalMilestones(goalId: string | undefined) {
  return useQuery({
    queryKey: ['goals', 'milestones', goalId],
    queryFn: async () => (goalId ? listMilestones(goalId) : []),
    enabled: !!goalId,
  });
}

export function useGoalProgressLogs(goalId: string | undefined) {
  return useQuery({
    queryKey: ['goals', 'progress-logs', goalId],
    queryFn: async () => (goalId ? listProgressLogs(goalId) : []),
    enabled: !!goalId,
  });
}
