import { useQuery } from '@tanstack/react-query';

import { getNote } from '@/features/notes/services/notes-repository';
import { getTask } from '@/features/tasks/services/tasks-repository';

export function useTask(id: string | undefined) {
  return useQuery({
    queryKey: ['tasks', 'detail', id],
    queryFn: async () => (id ? getTask(id) : null),
    enabled: !!id,
  });
}

/** The note this task was created from, if any — shares its cache key with
 *  `useNote()` so opening the task doesn't refetch a note already in cache. */
export function useSourceNote(noteId: string | null | undefined) {
  return useQuery({
    queryKey: ['notes', 'detail', noteId],
    queryFn: async () => (noteId ? getNote(noteId) : null),
    enabled: !!noteId,
  });
}
