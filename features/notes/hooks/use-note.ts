import { useQuery } from '@tanstack/react-query';

import {
  getNote,
  listAttachmentsForNote,
  listBacklinksForNote,
  listTagsForNote,
  listTasksGeneratedFromNote,
} from '@/features/notes/services/notes-repository';

export function useNote(id: string) {
  return useQuery({ queryKey: ['notes', 'detail', id], queryFn: async () => getNote(id) });
}

export function useNoteTagsForNote(id: string) {
  return useQuery({
    queryKey: ['notes', 'detail', id, 'tags'],
    queryFn: async () => listTagsForNote(id),
  });
}

export function useNoteAttachments(id: string) {
  return useQuery({
    queryKey: ['notes', 'detail', id, 'attachments'],
    queryFn: async () => listAttachmentsForNote(id),
  });
}

export function useNoteBacklinks(id: string) {
  return useQuery({
    queryKey: ['notes', 'detail', id, 'backlinks'],
    queryFn: async () => listBacklinksForNote(id),
  });
}

export function useNoteGeneratedTasks(id: string) {
  return useQuery({
    queryKey: ['notes', 'detail', id, 'generated-tasks'],
    queryFn: async () => listTasksGeneratedFromNote(id),
  });
}
