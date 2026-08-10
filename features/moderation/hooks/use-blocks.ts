import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { blockUser, listBlockedAccounts, unblockUser } from '@/features/moderation/services/blocks';
import { useAuthStore } from '@/features/auth/services/auth-store';
import { albumKeys } from '@/features/private/hooks/use-shared-albums';
import { splitKeys } from '@/features/split/hooks/use-split';

export const blockKeys = {
  list: ['moderation', 'blocks'] as const,
};

/** The accounts you have blocked. Signed-out and guest sessions have none —
 *  blocking is between accounts, and there is nobody to block without one. */
export function useBlockedAccounts() {
  const session = useAuthStore((s) => s.session);
  return useQuery({
    queryKey: blockKeys.list,
    queryFn: listBlockedAccounts,
    enabled: session !== null,
  });
}

export function useBlockMutations() {
  const client = useQueryClient();

  // Invalidates the split AND shared-album caches as well as the block list:
  // a block changes what the server will let you do with both (0021's guard
  // triggers, mirrored for albums in 0027), so a screen still holding the
  // previous answer would offer an invite that now fails.
  const invalidate = () => {
    client.invalidateQueries({ queryKey: blockKeys.list });
    client.invalidateQueries({ queryKey: splitKeys.groups });
    client.invalidateQueries({ queryKey: splitKeys.summaries });
    client.invalidateQueries({ queryKey: albumKeys.list });
  };

  return {
    block: useMutation({ mutationFn: blockUser, onSuccess: invalidate }),
    unblock: useMutation({ mutationFn: unblockUser, onSuccess: invalidate }),
  };
}
