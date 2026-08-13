import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { importSongs } from '@/features/music/services/song-import';
import {
  deleteSong,
  listSongs,
  toggleSongFavorite,
  updateSong,
} from '@/features/music/services/songs-repository';

export function useSongs() {
  return useQuery({ queryKey: ['music', 'songs'], queryFn: listSongs });
}

export function useSongMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['music'] });

  const importFromDevice = useMutation({
    mutationFn: async () => importSongs(),
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: async ({
      id,
      input,
    }: {
      id: string;
      input: { title?: string; artist?: string | null };
    }) => updateSong(id, input),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => deleteSong(id),
    onSuccess: invalidate,
  });

  const toggleFavorite = useMutation({
    mutationFn: async ({ id, isFavorite }: { id: string; isFavorite: boolean }) =>
      toggleSongFavorite(id, isFavorite),
    onSuccess: invalidate,
  });

  return { importFromDevice, update, remove, toggleFavorite };
}
