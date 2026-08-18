import { and, eq, inArray, isNull } from 'drizzle-orm';

import { getDb } from '@/database/client';
import { noteTags, taskTagLinks } from '@/database/schema';
import type { NoteTag } from '@/features/notes/types/note.types';
import { LOCAL_USER_ID } from '@/lib/local-user';

/**
 * Tags on tasks, over the vocabulary in `note_tags`.
 *
 * The tag list itself — creating, renaming, deleting — stays owned by
 * `notes-repository`, because a tag is one thing shared by both modules and
 * two modules that can both create it is two places for the same bug. This file
 * only ever touches the links.
 */

function toTag(row: typeof noteTags.$inferSelect): NoteTag {
  return { id: row.id, name: row.name, colorToken: row.colorToken };
}

export function listTagsForTask(taskId: string): NoteTag[] {
  const db = getDb();
  const links = db
    .select()
    .from(taskTagLinks)
    .where(and(eq(taskTagLinks.taskId, taskId), isNull(taskTagLinks.deletedAt)))
    .all();

  const tagIds = links.map((link) => link.tagId);
  if (tagIds.length === 0) return [];

  return db
    .select()
    .from(noteTags)
    .where(and(inArray(noteTags.id, tagIds), isNull(noteTags.deletedAt)))
    .all()
    .map(toTag);
}

/** Every task carrying a given tag — the query the shared vocabulary exists
 *  for, and what the tag filter on the task list reads. */
export function listTaskIdsForTag(tagId: string): string[] {
  return getDb()
    .select({ taskId: taskTagLinks.taskId })
    .from(taskTagLinks)
    .where(and(eq(taskTagLinks.tagId, tagId), isNull(taskTagLinks.deletedAt)))
    .all()
    .map((row) => row.taskId);
}

export function setTagsForTask(taskId: string, tagIds: string[]) {
  const db = getDb();
  const now = Date.now();
  const wanted = new Set(tagIds);

  // Reconciled rather than cleared-and-reinserted, exactly as setTagsForNote
  // does: the link id is derived from the pair, so re-adding a tag reuses the
  // row it had before. Reviving it is one UPDATE and keeps the id stable across
  // devices — a delete-then-insert would produce a tombstone and a new row for
  // the same pair, and the unique index on (task_id, tag_id) would refuse the
  // second one.
  const existing = db.select().from(taskTagLinks).where(eq(taskTagLinks.taskId, taskId)).all();
  const known = new Set(existing.map((link) => link.tagId));

  for (const link of existing) {
    const shouldExist = wanted.has(link.tagId);
    if (shouldExist === (link.deletedAt === null)) continue;
    db.update(taskTagLinks)
      .set({ deletedAt: shouldExist ? null : now, updatedAt: now })
      .where(and(eq(taskTagLinks.taskId, taskId), eq(taskTagLinks.tagId, link.tagId)))
      .run();
  }

  for (const tagId of tagIds) {
    if (known.has(tagId)) continue;
    db.insert(taskTagLinks)
      .values({
        id: `${taskId}:${tagId}`,
        userId: LOCAL_USER_ID,
        taskId,
        tagId,
        updatedAt: now,
      })
      .run();
  }
}

/** Drops a task's tag links when the task goes. Soft, because a hard DELETE
 *  leaves nothing for the sync push to carry and the link returns on the next
 *  pull. */
export function deleteTagLinksForTask(taskId: string) {
  const now = Date.now();
  getDb()
    .update(taskTagLinks)
    .set({ deletedAt: now, updatedAt: now })
    .where(and(eq(taskTagLinks.taskId, taskId), isNull(taskTagLinks.deletedAt)))
    .run();
}
