import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import {
  listOpenConflicts,
  openConflictCount,
  resolveAllConflicts,
  resolveConflict,
  restoreConflict,
  type SyncConflict,
} from '@/features/sync/services/conflict-repository';

const KEY = ['sync-conflicts'];

export function useSyncConflicts() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: KEY,
    queryFn: () => listOpenConflicts(),
  });

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: KEY });
  }, [queryClient]);

  return {
    conflicts: query.data ?? [],
    isLoading: query.isLoading,
    restore: useCallback(
      (conflict: SyncConflict) => {
        restoreConflict(conflict);
        invalidate();
        // The restored row is a fresh local edit, so every list showing it is
        // now stale. Cheaper to be blunt than to map table names onto the
        // dozen query keys that might be displaying them.
        void queryClient.invalidateQueries();
      },
      [invalidate, queryClient],
    ),
    keepRemote: useCallback(
      (id: string) => {
        resolveConflict(id, 'kept_remote');
        invalidate();
      },
      [invalidate],
    ),
    dismissAll: useCallback(() => {
      resolveAllConflicts('kept_remote');
      invalidate();
    }, [invalidate]),
  };
}

/** Just the badge number, for the Sync screen's row. */
export function useOpenConflictCount(): number {
  const query = useQuery({ queryKey: [...KEY, 'count'], queryFn: () => openConflictCount() });
  return query.data ?? 0;
}
