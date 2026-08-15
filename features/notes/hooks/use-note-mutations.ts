import { useQueryClient, useMutation } from '@tanstack/react-query';

import { cancelNoteReminder, syncNoteReminder } from '@/features/notes/services/note-reminders';
import {
  addNoteAttachment,
  archiveNote,
  createNote,
  deleteNote,
  deleteNoteAttachment,
  getNote,
  restoreNote,
  setTagsForNote,
  unarchiveNote,
  updateNote,
} from '@/features/notes/services/notes-repository';
import type {
  CreateNoteInput,
  NoteAttachment,
  UpdateNoteInput,
} from '@/features/notes/types/note.types';

export function useNoteMutations() {
  const queryClient = useQueryClient();

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['notes'] });

  const create = useMutation({
    mutationFn: async (input: CreateNoteInput) => {
      const note = createNote(input);
      await syncNoteReminder(note);
      return note;
    },
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: async ({ id, input }: { id: string; input: UpdateNoteInput }) => {
      updateNote(id, input);
      if (input.reminderAt !== undefined) {
        const note = getNote(id);
        if (note) await syncNoteReminder(note);
      }
    },
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const note = getNote(id);
      deleteNote(id);
      if (note) await cancelNoteReminder(note);
    },
    onSuccess: invalidate,
  });

  /** Puts back a note the user just deleted, from the undo toast. */
  const restore = useMutation({
    mutationFn: async (id: string) => {
      restoreNote(id);
      const note = getNote(id);
      if (note) await syncNoteReminder(note);
    },
    onSuccess: invalidate,
  });

  const archive = useMutation({
    mutationFn: async (id: string) => {
      const note = getNote(id);
      archiveNote(id);
      if (note) await cancelNoteReminder(note);
    },
    onSuccess: invalidate,
  });

  /** Un-archiving has to put the reminder back: `archive` cancelled it, and
   *  without this the note returns to the list looking like it still has one
   *  while nothing is queued. */
  const unarchive = useMutation({
    mutationFn: async (id: string) => {
      unarchiveNote(id);
      const note = getNote(id);
      if (note) await syncNoteReminder(note);
    },
    onSuccess: invalidate,
  });

  const setTags = useMutation({
    mutationFn: async ({ id, tagIds }: { id: string; tagIds: string[] }) =>
      setTagsForNote(id, tagIds),
    onSuccess: (_data, variables) =>
      queryClient.invalidateQueries({ queryKey: ['notes', 'detail', variables.id, 'tags'] }),
  });

  const attach = useMutation({
    mutationFn: async ({
      id,
      kind,
      uri,
      durationMs,
    }: {
      id: string;
      kind: NoteAttachment['kind'];
      uri: string;
      durationMs?: number | null;
    }) => addNoteAttachment(id, kind, uri, durationMs),
    onSuccess: (_data, variables) =>
      queryClient.invalidateQueries({ queryKey: ['notes', 'detail', variables.id, 'attachments'] }),
  });

  const removeAttachment = useMutation({
    mutationFn: async ({ id }: { id: string; noteId: string }) => deleteNoteAttachment(id),
    onSuccess: (_data, variables) =>
      queryClient.invalidateQueries({
        queryKey: ['notes', 'detail', variables.noteId, 'attachments'],
      }),
  });

  return {
    create,
    update,
    remove,
    restore,
    archive,
    unarchive,
    setTags,
    attach,
    removeAttachment,
  };
}
