import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuthStore } from '@/features/auth/services/auth-store';
import { albumKeys } from '@/features/private/hooks/use-shared-albums';
import {
  encryptMilestoneTitle,
  tryDecryptMilestoneTitle,
} from '@/features/private/services/album-crypto';
import * as repo from '@/features/private/services/album-repository';
import type { AlbumMilestone } from '@/features/private/types/shared-album.types';

/** Custom milestones (migration 0039) — same sibling-hook shape as
 *  use-album-plans.ts. */

export type DecryptedMilestone = AlbumMilestone & { title: string | null };

export function useAlbumMilestones(albumId: string | undefined, albumKey: Uint8Array | null) {
  return useQuery({
    queryKey: albumKeys.milestones(albumId ?? ''),
    enabled: !!albumId && !!albumKey,
    queryFn: async () => {
      const rows = await repo.listMilestones(albumId!);
      return rows.map((m) => ({
        ...m,
        title: albumKey ? tryDecryptMilestoneTitle(albumKey, m.titleCiphertext) : null,
      })) satisfies DecryptedMilestone[];
    },
  });
}

export function useAlbumMilestoneMutations(albumId?: string) {
  const queryClient = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: albumKeys.milestones(albumId ?? '') });

  const addMilestone = useMutation({
    mutationFn: (input: {
      title: string;
      milestoneDate: string;
      recurring: boolean;
      albumKey: Uint8Array;
    }) =>
      repo.addMilestone({
        albumId: albumId!,
        authorId: userId ?? '',
        titleCiphertext: encryptMilestoneTitle(input.albumKey, input.title),
        milestoneDate: input.milestoneDate,
        recurring: input.recurring,
      }),
    onSuccess: invalidate,
  });

  const updateMilestone = useMutation({
    mutationFn: (input: {
      milestoneId: string;
      title: string;
      milestoneDate: string;
      recurring: boolean;
      albumKey: Uint8Array;
    }) =>
      repo.updateMilestone(input.milestoneId, {
        titleCiphertext: encryptMilestoneTitle(input.albumKey, input.title),
        milestoneDate: input.milestoneDate,
        recurring: input.recurring,
      }),
    onSuccess: invalidate,
  });

  const removeMilestone = useMutation({
    mutationFn: (milestoneId: string) => repo.removeMilestone(milestoneId),
    onSuccess: invalidate,
  });

  return { addMilestone, updateMilestone, removeMilestone };
}
