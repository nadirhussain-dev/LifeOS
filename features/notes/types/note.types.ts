export type NoteCategory = {
  id: string;
  name: string;
  colorToken: string;
  icon: string;
  deletedAt?: number | null;
};

export type Note = {
  id: string;
  title: string;
  body: string | null;
  categoryId: string | null;
  isPinned: boolean;
  isArchived: boolean;
  wordCount: number;
  reminderAt: number | null;
  reminderNotificationId: string | null;
  createdAt: number;
  updatedAt: number;
};

export type CreateNoteInput = {
  title: string;
  body?: string | null;
  categoryId?: string | null;
  isPinned?: boolean;
  reminderAt?: number | null;
};

export type UpdateNoteInput = Partial<CreateNoteInput> & { isArchived?: boolean };

export type NoteTag = {
  id: string;
  name: string;
  colorToken: string | null;
};

export type NoteAttachment = {
  id: string;
  noteId: string;
  kind: 'image' | 'audio' | 'pdf' | 'file';
  uri: string;
  thumbnailUri: string | null;
  durationMs: number | null;
  createdAt: number;
};

/** A note whose body contains `[[This Note]]` — the seed of the backlink graph. */
export type NoteBacklink = {
  id: string;
  title: string;
};

/** A task created from this note via the "Create task" action — the note's
 *  own view of the `generated_from` entryLinks relation. */
export type GeneratedTask = {
  id: string;
  title: string;
  status: 'todo' | 'in_progress' | 'completed' | 'archived';
};
