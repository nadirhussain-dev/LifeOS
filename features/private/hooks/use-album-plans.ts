import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuthStore } from '@/features/auth/services/auth-store';
import { albumKeys } from '@/features/private/hooks/use-shared-albums';
import {
  encryptEventNotes,
  encryptEventTitle,
  tryDecryptEventNotes,
  tryDecryptEventTitle,
} from '@/features/private/services/album-crypto';
import * as repo from '@/features/private/services/album-repository';
import type { AlbumEvent } from '@/features/private/types/shared-album.types';

/**
 * Shared Plans (migration 0038) — sibling to use-shared-albums.ts rather
 * than another export crammed into it (that file was already 378 lines
 * before this). Same query/decrypt/mutate shape as useAlbumComments and
 * useSharedAlbumMutations's comment mutations; `albumKeys` stays the single
 * source of truth for query keys so useAlbumRealtime (still in
 * use-shared-albums.ts) can invalidate them without importing this file.
 */

export type DecryptedEvent = AlbumEvent & { title: string | null; notes: string | null };

export function useAlbumEvents(albumId: string | undefined, albumKey: Uint8Array | null) {
  return useQuery({
    queryKey: albumKeys.events(albumId ?? ''),
    enabled: !!albumId && !!albumKey,
    queryFn: async () => {
      const rows = await repo.listEvents(albumId!);
      return rows.map((e) => ({
        ...e,
        title: albumKey ? tryDecryptEventTitle(albumKey, e.titleCiphertext) : null,
        notes:
          albumKey && e.notesCiphertext ? tryDecryptEventNotes(albumKey, e.notesCiphertext) : null,
      })) satisfies DecryptedEvent[];
    },
  });
}

export function useAlbumPlanMutations(albumId?: string) {
  const queryClient = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: albumKeys.events(albumId ?? '') });

  const addEvent = useMutation({
    mutationFn: (input: {
      title: string;
      notes: string;
      eventDate: string;
      albumKey: Uint8Array;
    }) =>
      repo.addEvent({
        albumId: albumId!,
        authorId: userId ?? '',
        titleCiphertext: encryptEventTitle(input.albumKey, input.title),
        notesCiphertext: input.notes.trim() ? encryptEventNotes(input.albumKey, input.notes) : null,
        eventDate: input.eventDate,
      }),
    onSuccess: invalidate,
  });

  const updateEvent = useMutation({
    mutationFn: (input: {
      eventId: string;
      title: string;
      notes: string;
      eventDate: string;
      albumKey: Uint8Array;
    }) =>
      repo.updateEvent(input.eventId, {
        titleCiphertext: encryptEventTitle(input.albumKey, input.title),
        notesCiphertext: input.notes.trim() ? encryptEventNotes(input.albumKey, input.notes) : null,
        eventDate: input.eventDate,
      }),
    onSuccess: invalidate,
  });

  const removeEvent = useMutation({
    mutationFn: (eventId: string) => repo.removeEvent(eventId),
    onSuccess: invalidate,
  });

  return { addEvent, updateEvent, removeEvent };
}
