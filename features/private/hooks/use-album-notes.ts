import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuthStore } from '@/features/auth/services/auth-store';
import { albumKeys } from '@/features/private/hooks/use-shared-albums';
import { encryptNoteBody, tryDecryptNoteBody } from '@/features/private/services/album-crypto';
import * as repo from '@/features/private/services/album-repository';
import type { AlbumNote } from '@/features/private/types/shared-album.types';

/** Shared Notes (migration 0040) — same sibling-hook shape as
 *  use-album-plans.ts/use-album-milestones.ts. */

export type DecryptedNote = AlbumNote & { body: string | null };

export function useAlbumNotes(albumId: string | undefined, albumKey: Uint8Array | null) {
  return useQuery({
    queryKey: albumKeys.notes(albumId ?? ''),
    enabled: !!albumId && !!albumKey,
    queryFn: async () => {
      const rows = await repo.listNotes(albumId!);
      return rows.map((n) => ({
        ...n,
        body: albumKey ? tryDecryptNoteBody(albumKey, n.bodyCiphertext) : null,
      })) satisfies DecryptedNote[];
    },
  });
}

export function useAlbumNoteMutations(albumId?: string) {
  const queryClient = useQueryClient();
  const profile = useAuthStore((s) => s.profile);
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: albumKeys.notes(albumId ?? '') });

  /** Insert is refused server-side unless allow_notes is on — see
   *  album_allows_notes() (0040). The caller hides the composer when it's
   *  off; this is the enforcement, not the UX, same split as addComment. */
  const addNote = useMutation({
    mutationFn: (input: { body: string; albumKey: Uint8Array }) =>
      repo.addNote({
        albumId: albumId!,
        authorId: userId ?? '',
        authorName: profile?.displayName || profile?.username || null,
        bodyCiphertext: encryptNoteBody(input.albumKey, input.body),
      }),
    onSuccess: invalidate,
  });

  const removeNote = useMutation({
    mutationFn: (noteId: string) => repo.removeNote(noteId),
    onSuccess: invalidate,
  });

  return { addNote, removeNote };
}
