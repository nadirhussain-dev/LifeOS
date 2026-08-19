import { useMutation, useQueryClient } from '@tanstack/react-query';

import {
  createAlbum,
  createPhoto,
  deleteAlbum,
  deletePhoto,
  togglePhotoFavorite,
  updateAlbum,
  updatePhoto,
} from '@/features/gallery/services/gallery-repository';
import {
  pickMedia,
  saveCapturedImage,
  type MediaKind,
  type MediaSource,
} from '@/features/gallery/services/gallery-storage';
import type {
  AlbumCategory,
  GalleryAlbum,
  UpdatePhotoInput,
} from '@/features/gallery/types/gallery.types';

export class PermissionDeniedError extends Error {
  constructor() {
    super('Photo library permission denied');
    this.name = 'PermissionDeniedError';
  }
}

export function useGalleryMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['gallery'] });

  /** Picks/captures photos & videos, copies them into app storage (+poster for
   * videos), and writes a row per item. Resolves to how many were imported and
   * how many videos were rejected for exceeding the size cap. Throws
   * PermissionDeniedError if the user declined library/camera access. */
  const importMedia = useMutation({
    mutationFn: async (opts: {
      albumId: string | null;
      source: MediaSource;
      mediaTypes: MediaKind[];
    }) => {
      const result = await pickMedia({ source: opts.source, mediaTypes: opts.mediaTypes });
      if (result === null) throw new PermissionDeniedError();
      for (const media of result.items) {
        createPhoto({
          albumId: opts.albumId,
          uri: media.uri,
          mediaType: media.mediaType,
          durationMs: media.durationMs,
          thumbnailUri: media.thumbnailUri,
          width: media.width,
          height: media.height,
        });
      }
      return { imported: result.items.length, rejectedOversize: result.rejectedOversize };
    },
    onSuccess: invalidate,
  });

  /** Persists a rendered before/after card (temp uri from view-shot) as a
   * real photo in the feed, tagged so it's recognizable as a comparison. */
  const saveComparison = useMutation({
    mutationFn: async ({
      tempUri,
      caption,
      takenAt,
    }: {
      tempUri: string;
      caption?: string | null;
      takenAt?: number;
    }) => {
      const saved = await saveCapturedImage(tempUri);
      createPhoto({
        albumId: null,
        uri: saved.uri,
        mediaType: 'photo',
        width: saved.width,
        height: saved.height,
        caption: caption?.trim() || null,
        tags: ['comparison'],
        takenAt,
      });
    },
    onSuccess: invalidate,
  });

  const addAlbum = useMutation({
    mutationFn: async ({ name, category }: { name: string; category: AlbumCategory }) =>
      createAlbum(name, category),
    onSuccess: invalidate,
  });

  const editAlbum = useMutation({
    mutationFn: async ({
      id,
      patch,
    }: {
      id: string;
      patch: Partial<Pick<GalleryAlbum, 'name' | 'category' | 'coverPhotoId'>>;
    }) => updateAlbum(id, patch),
    onSuccess: invalidate,
  });

  const removeAlbum = useMutation({
    mutationFn: async (id: string) => deleteAlbum(id),
    onSuccess: invalidate,
  });

  const editPhoto = useMutation({
    mutationFn: async ({ id, input }: { id: string; input: UpdatePhotoInput }) =>
      updatePhoto(id, input),
    onSuccess: invalidate,
  });

  /**
   * Fills the heart before the write lands.
   *
   * A photo appears under several cache keys — all photos, an album's photos,
   * the favourites list, the single-photo view — so this patches every cached
   * list that happens to contain it rather than naming one key. `setQueriesData`
   * with a prefix is what makes that one operation instead of four that can
   * fall out of step.
   *
   * Membership of the favourites *list* is deliberately not adjusted, only the
   * flag: un-favouriting from that screen leaves the photo in place until the
   * refetch, which is better than a tile vanishing from under the finger that
   * tapped it.
   */
  const toggleFavorite = useMutation({
    mutationFn: async ({ id, isFavorite }: { id: string; isFavorite: boolean }) =>
      togglePhotoFavorite(id, isFavorite),
    onMutate: async ({ id, isFavorite }) => {
      await queryClient.cancelQueries({ queryKey: ['gallery'] });
      const snapshot = queryClient.getQueriesData({ queryKey: ['gallery'] });

      queryClient.setQueriesData({ queryKey: ['gallery'] }, (current: unknown) => {
        if (Array.isArray(current)) {
          return current.map((entry) =>
            entry && typeof entry === 'object' && 'id' in entry && entry.id === id
              ? { ...entry, isFavorite }
              : entry,
          );
        }
        if (current && typeof current === 'object' && 'id' in current && current.id === id) {
          return { ...current, isFavorite };
        }
        return current;
      });

      return { snapshot };
    },
    onError: (_error, _variables, context) => {
      for (const [key, data] of context?.snapshot ?? []) {
        queryClient.setQueryData(key, data);
      }
    },
    onSettled: invalidate,
  });

  const removePhoto = useMutation({
    mutationFn: async (id: string) => deletePhoto(id),
    onSuccess: invalidate,
  });

  return {
    importMedia,
    saveComparison,
    addAlbum,
    editAlbum,
    removeAlbum,
    editPhoto,
    toggleFavorite,
    removePhoto,
  };
}
