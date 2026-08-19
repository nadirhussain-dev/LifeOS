import { useQuery } from '@tanstack/react-query';

import {
  getNoteCategoryById,
  listArchivedNotes,
  listNoteCategories,
  listNotes,
  listTags,
} from '@/features/notes/services/notes-repository';
import { searchNoteIds } from '@/features/notes/services/note-search';
import { useNotesFilterStore } from '@/features/notes/store/notes-filter-store';

export function useNotes() {
  const { searchQuery } = useNotesFilterStore();
  const query = searchQuery.trim();

  /**
   * Matched ids come from the full-text index, which is a separate query
   * because it is a different question from "what are my notes" and must not
   * invalidate that list on every keystroke.
   *
   * Ranking is the index's, and the order is preserved below. A body match on a
   * note about the thing beats a title match on a note that merely mentions it,
   * and re-sorting the ids by the notes list's own order would throw that away.
   */
  const { data: matchedIds } = useQuery({
    queryKey: ['notes', 'search', query],
    queryFn: async () => searchNoteIds(query),
    enabled: query.length > 0,
    placeholderData: (previous) => previous,
  });

  return useQuery({
    queryKey: ['notes'],
    queryFn: async () => listNotes(),
    select: (notes) => {
      if (!query) return notes;
      // Still loading the first result for this query: showing every note would
      // flash the unfiltered list under the user's typing.
      if (!matchedIds) return [];
      const byId = new Map(notes.map((note) => [note.id, note]));
      return matchedIds
        .map((id) => byId.get(id))
        .filter((note): note is NonNullable<typeof note> => note !== undefined);
    },
  });
}

export function useArchivedNotes() {
  return useQuery({ queryKey: ['notes', 'archived'], queryFn: async () => listArchivedNotes() });
}

export function useNoteTags() {
  return useQuery({ queryKey: ['note-tags'], queryFn: async () => listTags() });
}

export function useNoteCategories() {
  return useQuery({ queryKey: ['note-categories'], queryFn: async () => listNoteCategories() });
}

/** Resolves a category by id regardless of soft-delete, so an already-assigned note keeps showing its label. */
export function useNoteCategoryById(id: string | null) {
  return useQuery({
    queryKey: ['note-categories', 'detail', id],
    queryFn: async () => (id ? getNoteCategoryById(id) : null),
    enabled: !!id,
  });
}
