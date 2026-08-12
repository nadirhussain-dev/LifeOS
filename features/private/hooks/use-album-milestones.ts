import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuthStore } from '@/features/auth/services/auth-store';
import { albumKeys } from '@/features/private/hooks/use-shared-albums';
import {
  encryptMilestoneTitle,
  tryDecryptMilestoneTitle,
} from '@/features/private/services/album-crypto';
import * as repo from '@/features/private/services/album-repository';
import { syncTogetherReminders } from '@/features/private/services/together-reminders';
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
  // Rebuilds the Together "something's coming up" reminder immediately
  // rather than waiting for the next unrelated resync — same reasoning as
  // cycle.tsx's `reloadAndResync`. Cheap and safe to call regardless of
  // whether `albumId` happens to be the Together hub right now:
  // syncTogetherReminders() re-derives the hub itself and no-ops if this
  // album isn't it.
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: albumKeys.milestones(albumId ?? '') });
    void syncTogetherReminders();
  };

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
