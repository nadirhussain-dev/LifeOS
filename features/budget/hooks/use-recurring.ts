import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import {
  createRecurring,
  deleteRecurring,
  listRecurring,
  materializeRecurring,
  setRecurringActive,
} from '@/features/budget/services/budget-repository';
import { reportError } from '@/lib/error-reporting';
import type { CreateRecurringInput } from '@/features/budget/types/budget.types';

export function useRecurring() {
  return useQuery({ queryKey: ['budget', 'recurring'], queryFn: async () => listRecurring() });
}

export function useRecurringMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['budget'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const add = useMutation({
    mutationFn: async (input: CreateRecurringInput) => createRecurring(input),
    onSuccess: invalidate,
  });

  const setActive = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) =>
      setRecurringActive(id, isActive),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => deleteRecurring(id),
    onSuccess: invalidate,
  });

  return { add, setActive, remove };
}

/**
 * Posts any recurring transactions the app owes, once per mount.
 *
 * Runs from the budget screen rather than app start-up, deliberately. It touches
 * the database, and the one thing launch-time code must never do is fail in a
 * way that stops the app opening — while the cost of waiting until somebody
 * looks at their budget is nil, because the occurrences are dated from the rule
 * and not from when they were written.
 *
 * Guarded by a ref rather than an empty dependency array alone: React 19 in
 * development mounts effects twice, and while `materializeRecurring` is
 * idempotent by construction, running it twice per launch would still be two
 * write transactions for no reason.
 *
 * Failures are reported and swallowed. A rule with a corrupt anchor must not
 * take the budget screen down with it.
 */
export function useMaterializeRecurring() {
  const queryClient = useQueryClient();
  const hasRun = useRef(false);

  useEffect(() => {
    if (hasRun.current) return;
    hasRun.current = true;
    try {
      if (materializeRecurring() > 0) {
        queryClient.invalidateQueries({ queryKey: ['budget'] });
        queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      }
    } catch (error) {
      reportError(error, { scope: 'materializeRecurring' });
    }
  }, [queryClient]);
}
