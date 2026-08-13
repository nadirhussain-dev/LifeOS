import { useQuery } from '@tanstack/react-query';

import {
  getNoteCategoryById,
  listArchivedNotes,
  listNoteCategories,
  listNotes,
  listTags,
} from '@/features/notes/services/notes-repository';
import { useNotesFilterStore } from '@/features/notes/store/notes-filter-store';

export function useNotes() {
  const { searchQuery } = useNotesFilterStore();

  return useQuery({
    queryKey: ['notes'],
    queryFn: async () => listNotes(),
    // Matches global search's own reach (features/search/services/search-sources.ts),
    // which already scores note bodies — the in-module list search used to stop at
    // the title, so a note you could find from global search was invisible here.
    select: (notes) => {
      const query = searchQuery.trim().toLowerCase();
      if (!query) return notes;
      return notes.filter(
        (note) =>
          note.title.toLowerCase().includes(query) ||
          (note.body ?? '').toLowerCase().includes(query),
      );
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
