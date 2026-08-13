import { and, desc, eq, gt, inArray, isNull } from 'drizzle-orm';

import { getDb } from '@/database/client';
import {
  entryLinks,
  noteAttachments,
  noteCategories,
  noteTagLinks,
  noteTags,
  notes,
  tasks,
} from '@/database/schema';
import { createTask } from '@/features/tasks/services/tasks-repository';
import { generateId } from '@/lib/id';
import { LOCAL_USER_ID } from '@/lib/local-user';
import type {
  CreateNoteInput,
  GeneratedTask,
  Note,
  NoteAttachment,
  NoteBacklink,
  NoteCategory,
  NoteTag,
  UpdateNoteInput,
} from '@/features/notes/types/note.types';

function countWords(body: string | null): number {
  if (!body) return 0;
  const matches = body.trim().match(/\S+/g);
  return matches ? matches.length : 0;
}

export function listNotes(): Note[] {
  return getDb()
    .select()
    .from(notes)
    .where(
      and(eq(notes.userId, LOCAL_USER_ID), isNull(notes.deletedAt), eq(notes.isArchived, false)),
    )
    .orderBy(desc(notes.isPinned), desc(notes.updatedAt))
    .all();
}

export function listArchivedNotes(): Note[] {
  return getDb()
    .select()
    .from(notes)
    .where(
      and(eq(notes.userId, LOCAL_USER_ID), isNull(notes.deletedAt), eq(notes.isArchived, true)),
    )
    .orderBy(desc(notes.updatedAt))
    .all();
}

export function listRecentNotes(limit: number): Note[] {
  return listNotes().slice(0, limit);
}

/** Notes whose reminder is still in the future — what a resync has to rebuild.
 *  Past reminders are left alone: they have already fired. */
export function listNotesWithReminders(now = Date.now()): Note[] {
  return getDb()
    .select()
    .from(notes)
    .where(and(eq(notes.userId, LOCAL_USER_ID), isNull(notes.deletedAt), gt(notes.reminderAt, now)))
    .all();
}

export function getNote(id: string): Note | null {
  return getDb().select().from(notes).where(eq(notes.id, id)).get() ?? null;
}

export function createNote(input: CreateNoteInput): Note {
  const now = Date.now();
  const note: Note = {
    id: generateId(),
    title: input.title,
    body: input.body ?? null,
    categoryId: input.categoryId ?? null,
    isPinned: input.isPinned ?? false,
    isArchived: false,
    wordCount: countWords(input.body ?? null),
    reminderAt: input.reminderAt ?? null,
    reminderNotificationId: null,
    createdAt: now,
    updatedAt: now,
  };
  getDb()
    .insert(notes)
    .values({ ...note, userId: LOCAL_USER_ID, syncStatus: 'pending' })
    .run();
  if (note.body) syncNoteLinks(note.id, note.body);
  return note;
}

export function updateNote(id: string, input: UpdateNoteInput) {
  const wordCount = input.body !== undefined ? { wordCount: countWords(input.body) } : {};
  getDb()
    .update(notes)
    .set({ ...input, ...wordCount, updatedAt: Date.now(), syncStatus: 'pending' })
    .where(eq(notes.id, id))
    .run();

  if (input.body !== undefined) syncNoteLinks(id, input.body ?? '');
}

export function setNoteReminderNotificationId(id: string, notificationId: string | null) {
  getDb()
    .update(notes)
    .set({ reminderNotificationId: notificationId })
    .where(eq(notes.id, id))
    .run();
}

export function archiveNote(id: string) {
  getDb()
    .update(notes)
    .set({ isArchived: true, updatedAt: Date.now(), syncStatus: 'pending' })
    .where(eq(notes.id, id))
    .run();
}

export function unarchiveNote(id: string) {
  getDb()
    .update(notes)
    .set({ isArchived: false, updatedAt: Date.now(), syncStatus: 'pending' })
    .where(eq(notes.id, id))
    .run();
}

export function deleteNote(id: string) {
  getDb()
    .update(notes)
    // updatedAt must move so the delete is seen by the sync push (WHERE updated_at > cursor).
    .set({ deletedAt: Date.now(), updatedAt: Date.now(), syncStatus: 'pending' })
    .where(eq(notes.id, id))
    .run();
}

/** Undoes a soft delete. See restoreTask — `updatedAt` must move so the
 *  restore propagates through the same `updated_at > cursor` sync push. */
export function restoreNote(id: string) {
  getDb()
    .update(notes)
    .set({ deletedAt: null, updatedAt: Date.now(), syncStatus: 'pending' })
    .where(eq(notes.id, id))
    .run();
}

export function listNoteCategories(): NoteCategory[] {
  return getDb()
    .select()
    .from(noteCategories)
    .where(and(eq(noteCategories.userId, LOCAL_USER_ID), isNull(noteCategories.deletedAt)))
    .all();
}

export function getNoteCategoryById(id: string): NoteCategory | null {
  return getDb().select().from(noteCategories).where(eq(noteCategories.id, id)).get() ?? null;
}

export function createNoteCategory(name: string, colorToken: string, icon: string): NoteCategory {
  const now = Date.now();
  const category: NoteCategory = { id: generateId(), name, colorToken, icon };
  getDb()
    .insert(noteCategories)
    .values({ ...category, userId: LOCAL_USER_ID, createdAt: now, updatedAt: now })
    .run();
  return category;
}

export function deleteNoteCategory(id: string) {
  getDb()
    .update(noteCategories)
    .set({ deletedAt: Date.now(), updatedAt: Date.now() })
    .where(eq(noteCategories.id, id))
    .run();
}

// ---- Tags (many-to-many, distinct from the single-select category) ----

function toTag(row: typeof noteTags.$inferSelect): NoteTag {
  return { id: row.id, name: row.name, colorToken: row.colorToken };
}

export function listTags(): NoteTag[] {
  return getDb()
    .select()
    .from(noteTags)
    .where(and(eq(noteTags.userId, LOCAL_USER_ID), isNull(noteTags.deletedAt)))
    .all()
    .map(toTag);
}

export function createTag(name: string, colorToken?: string): NoteTag {
  const tag: NoteTag = { id: generateId(), name, colorToken: colorToken ?? null };
  const now = Date.now();
  getDb()
    .insert(noteTags)
    .values({ ...tag, userId: LOCAL_USER_ID, createdAt: now, updatedAt: now })
    .run();
  return tag;
}

/**
 * Soft delete, here and for the links below.
 *
 * Tags and their links sync now, and a row removed by hard DELETE leaves no
 * trace for the engine to push. The server would still hold it, the next pull
 * would write it back, and the tag would reappear on the device that deleted
 * it — reliably, and looking for all the world like a phantom bug. `deleted_at`
 * is what makes a removal travel.
 */
export function deleteTag(id: string) {
  const db = getDb();
  const now = Date.now();
  db.update(noteTagLinks)
    .set({ deletedAt: now, updatedAt: now })
    .where(and(eq(noteTagLinks.tagId, id), isNull(noteTagLinks.deletedAt)))
    .run();
  db.update(noteTags).set({ deletedAt: now, updatedAt: now }).where(eq(noteTags.id, id)).run();
}

export function listTagsForNote(noteId: string): NoteTag[] {
  const links = getDb()
    .select()
    .from(noteTagLinks)
    .where(and(eq(noteTagLinks.noteId, noteId), isNull(noteTagLinks.deletedAt)))
    .all();
  if (links.length === 0) return [];
  const tagIds = links.map((link) => link.tagId);
  return getDb()
    .select()
    .from(noteTags)
    .where(and(inArray(noteTags.id, tagIds), isNull(noteTags.deletedAt)))
    .all()
    .map(toTag);
}

export function setTagsForNote(noteId: string, tagIds: string[]) {
  const db = getDb();
  const now = Date.now();
  const wanted = new Set(tagIds);

  // Reconciled rather than cleared-and-reinserted: the link id is derived from
  // the pair (see database/schema.ts), so re-adding a tag reuses the row it had
  // before. Reviving it is one UPDATE and keeps the id stable across devices.
  const existing = db.select().from(noteTagLinks).where(eq(noteTagLinks.noteId, noteId)).all();
  const known = new Set(existing.map((link) => link.tagId));

  for (const link of existing) {
    const shouldExist = wanted.has(link.tagId);
    if (shouldExist === (link.deletedAt === null)) continue;
    db.update(noteTagLinks)
      .set({ deletedAt: shouldExist ? null : now, updatedAt: now })
      .where(and(eq(noteTagLinks.noteId, noteId), eq(noteTagLinks.tagId, link.tagId)))
      .run();
  }

  for (const tagId of tagIds) {
    if (known.has(tagId)) continue;
    db.insert(noteTagLinks)
      .values({
        id: `${noteId}:${tagId}`,
        userId: LOCAL_USER_ID,
        noteId,
        tagId,
        updatedAt: now,
      })
      .run();
  }
}

// ---- Attachments ----

function toAttachment(row: typeof noteAttachments.$inferSelect): NoteAttachment {
  return {
    id: row.id,
    noteId: row.noteId,
    kind: row.kind,
    uri: row.uri,
    thumbnailUri: row.thumbnailUri,
    durationMs: row.durationMs,
    createdAt: row.createdAt,
  };
}

export function listAttachmentsForNote(noteId: string): NoteAttachment[] {
  return getDb()
    .select()
    .from(noteAttachments)
    .where(and(eq(noteAttachments.noteId, noteId), isNull(noteAttachments.deletedAt)))
    .orderBy(noteAttachments.createdAt)
    .all()
    .map(toAttachment);
}

export function addNoteAttachment(
  noteId: string,
  kind: NoteAttachment['kind'],
  uri: string,
  durationMs?: number | null,
): NoteAttachment {
  const attachment: NoteAttachment = {
    id: generateId(),
    noteId,
    kind,
    uri,
    thumbnailUri: null,
    durationMs: durationMs ?? null,
    createdAt: Date.now(),
  };
  getDb()
    .insert(noteAttachments)
    .values({ ...attachment, userId: LOCAL_USER_ID, updatedAt: attachment.createdAt })
    .run();
  return attachment;
}

export function deleteNoteAttachment(id: string) {
  const now = Date.now();
  getDb()
    .update(noteAttachments)
    .set({ deletedAt: now, updatedAt: now })
    .where(eq(noteAttachments.id, id))
    .run();
}

// ---- Backlinks — `[[Note Title]]` mentions, the seed of the knowledge graph ----

const WIKI_LINK_PATTERN = /\[\[([^[\]]+)\]\]/g;

/**
 * Re-derives this note's outgoing `mentions` links from its body text. Called
 * on every body save.
 *
 * This used to clear the note's links and re-insert them under fresh random
 * ids. That was invisible while `entry_links` stayed on the device. Now that it
 * syncs, "delete every row and make new ones" runs on every keystroke-triggered
 * save: each pass would push a new set of rows to the server and leave the
 * previous set behind, because a hard DELETE leaves nothing for the engine to
 * push. A note edited fifty times would accumulate fifty generations of links.
 *
 * So the id is derived from the relationship itself — the same link always
 * lands on the same row, on every device — and the set is reconciled rather
 * than rebuilt. A save that changes no links now writes nothing at all.
 */
export function syncNoteLinks(noteId: string, body: string) {
  const db = getDb();
  const now = Date.now();

  const titles = [...body.matchAll(WIKI_LINK_PATTERN)].map((match) => match[1].trim());
  const allNotes = db
    .select()
    .from(notes)
    .where(and(eq(notes.userId, LOCAL_USER_ID), isNull(notes.deletedAt)))
    .all();

  const wanted = new Map<string, string>(); // link id -> target note id
  for (const title of titles) {
    const target = allNotes.find(
      (note) => note.id !== noteId && note.title.toLowerCase() === title.toLowerCase(),
    );
    if (!target) continue;
    wanted.set(mentionLinkId(noteId, target.id), target.id);
  }

  const existing = db
    .select()
    .from(entryLinks)
    .where(
      and(
        eq(entryLinks.sourceType, 'note'),
        eq(entryLinks.sourceId, noteId),
        eq(entryLinks.relation, 'mentions'),
      ),
    )
    .all();

  for (const link of existing) {
    const shouldExist = wanted.has(link.id);
    if (shouldExist === (link.deletedAt === null)) continue;
    db.update(entryLinks)
      .set({ deletedAt: shouldExist ? null : now, updatedAt: now })
      .where(eq(entryLinks.id, link.id))
      .run();
  }

  const known = new Set(existing.map((link) => link.id));
  for (const [id, targetId] of wanted) {
    if (known.has(id)) continue;
    db.insert(entryLinks)
      .values({
        id,
        userId: LOCAL_USER_ID,
        sourceType: 'note',
        sourceId: noteId,
        targetType: 'note',
        targetId,
        relation: 'mentions',
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }
}

/** Stable id for "note A mentions note B", so re-deriving the link finds the
 * row it made last time instead of creating another one. */
function mentionLinkId(sourceId: string, targetId: string): string {
  return `mentions:${sourceId}:${targetId}`;
}

/** Notes that link TO this one — i.e. this note's backlinks panel. */
export function listBacklinksForNote(noteId: string): NoteBacklink[] {
  const links = getDb()
    .select()
    .from(entryLinks)
    .where(
      and(
        eq(entryLinks.targetType, 'note'),
        eq(entryLinks.targetId, noteId),
        eq(entryLinks.relation, 'mentions'),
        isNull(entryLinks.deletedAt),
      ),
    )
    .all();
  if (links.length === 0) return [];

  const sourceIds = links.map((link) => link.sourceId);
  return getDb()
    .select()
    .from(notes)
    .where(and(inArray(notes.id, sourceIds), isNull(notes.deletedAt)))
    .all()
    .map((note) => ({ id: note.id, title: note.title || 'Untitled note' }));
}

/** Stable id for "note X generated task Y" — unlike `mentions`, these aren't
 *  re-derived from body text on every save (each call here is one deliberate
 *  user action), but the same stable-id shape keeps every entryLinks write in
 *  this file consistent. */
function generatedTaskLinkId(noteId: string, taskId: string): string {
  return `generated_from:${noteId}:${taskId}`;
}

/**
 * Creates a task from this note and records the connection both ways: the
 * task's own `sourceNoteId` column (a direct, cheap "where did this come
 * from" pointer, read from the task's side) and a `generated_from` entryLinks
 * row (so the note's side — "what came out of this" — can list every task
 * ever generated, not just track the most recent one).
 */
export function createTaskFromNote(noteId: string, title: string) {
  const task = createTask({ title, sourceNoteId: noteId });
  const now = Date.now();
  getDb()
    .insert(entryLinks)
    .values({
      id: generatedTaskLinkId(noteId, task.id),
      userId: LOCAL_USER_ID,
      sourceType: 'note',
      sourceId: noteId,
      targetType: 'task',
      targetId: task.id,
      relation: 'generated_from',
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return task;
}

/** Tasks created from this note — the note-side view of `generated_from`. */
export function listTasksGeneratedFromNote(noteId: string): GeneratedTask[] {
  const links = getDb()
    .select()
    .from(entryLinks)
    .where(
      and(
        eq(entryLinks.sourceType, 'note'),
        eq(entryLinks.sourceId, noteId),
        eq(entryLinks.relation, 'generated_from'),
        isNull(entryLinks.deletedAt),
      ),
    )
    .all();
  if (links.length === 0) return [];

  const taskIds = links.map((link) => link.targetId);
  return getDb()
    .select({ id: tasks.id, title: tasks.title, status: tasks.status })
    .from(tasks)
    .where(and(inArray(tasks.id, taskIds), isNull(tasks.deletedAt)))
    .all();
}
