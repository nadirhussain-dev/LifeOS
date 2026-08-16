import { and, desc, eq, gte, isNull, lte, or, sql } from 'drizzle-orm';

import { getDb } from '@/database/client';
import {
  journalAttachments,
  journalEntries,
  journalPrompts,
  journalReflections,
} from '@/database/schema';
import { generateId } from '@/lib/id';
import { LOCAL_USER_ID } from '@/lib/local-user';
import type {
  JournalAttachment,
  JournalEntry,
  JournalPrompt,
  JournalReflection,
  UpsertJournalEntryInput,
} from '@/features/journal/types/journal.types';

const DEFAULT_PROMPTS = [
  'What went well today?',
  'What challenged you?',
  'What are you grateful for?',
  'What did you learn?',
  'What would you improve tomorrow?',
];

function toEntry(row: typeof journalEntries.$inferSelect): JournalEntry {
  return {
    id: row.id,
    entryDate: row.entryDate,
    body: row.body,
    mood: row.mood,
    energy: row.energy,
    stress: row.stress,
    focus: row.focus,
    sleepHours: row.sleepHours,
    sleepQuality: row.sleepQuality,
    moodReasons: row.moodReasons ? (JSON.parse(row.moodReasons) as string[]) : null,
    locationLabel: row.locationLabel,
    locationLat: row.locationLat,
    locationLng: row.locationLng,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function getEntryByDate(entryDate: string): JournalEntry | null {
  const row = getDb()
    .select()
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.userId, LOCAL_USER_ID),
        eq(journalEntries.entryDate, entryDate),
        isNull(journalEntries.deletedAt),
      ),
    )
    .get();
  return row ? toEntry(row) : null;
}

/** Most recent entries, newest first — what global search reads. Bounded
 *  because search runs on every keystroke and a journal has no natural end. */
export function listRecentJournalEntries(limit = 400): JournalEntry[] {
  return getDb()
    .select()
    .from(journalEntries)
    .where(and(eq(journalEntries.userId, LOCAL_USER_ID), isNull(journalEntries.deletedAt)))
    .orderBy(desc(journalEntries.entryDate))
    .limit(limit)
    .all()
    .map(toEntry);
}

/** Inclusive date range, most recent first — the Timeline's paging unit. */
export function listEntriesBetween(startDate: string, endDate: string): JournalEntry[] {
  return getDb()
    .select()
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.userId, LOCAL_USER_ID),
        isNull(journalEntries.deletedAt),
        gte(journalEntries.entryDate, startDate),
        lte(journalEntries.entryDate, endDate),
      ),
    )
    .orderBy(desc(journalEntries.entryDate))
    .all()
    .map(toEntry);
}

/**
 * Entries sharing a month and day, in earlier years — the "on this day" source.
 *
 * Matched in SQL on the last five characters of `entry_date` rather than
 * loading a year and filtering in JS: a journal kept for a decade is thousands
 * of rows, and this runs on every visit to the Journal tab.
 *
 * There is no index for a suffix match, so this is a scan — bounded by the size
 * of one person's journal, on a local database, which is the one place a scan
 * is genuinely fine. If it ever stops being fine the fix is a generated
 * `month_day` column, not a cleverer query.
 */
export function listEntriesOnMonthDay(monthDay: string, beforeYear: number): JournalEntry[] {
  return getDb()
    .select()
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.userId, LOCAL_USER_ID),
        isNull(journalEntries.deletedAt),
        sql`substr(${journalEntries.entryDate}, 6) = ${monthDay}`,
        sql`cast(substr(${journalEntries.entryDate}, 1, 4) as integer) < ${beforeYear}`,
      ),
    )
    .orderBy(desc(journalEntries.entryDate))
    .all()
    .map(toEntry);
}

/** Upserts by (user, entryDate) — one entry per day, matching the schema's partial unique index. */
export function upsertEntry(input: UpsertJournalEntryInput): JournalEntry {
  const db = getDb();
  const now = Date.now();
  const existing = getEntryByDate(input.entryDate);
  const moodReasons =
    input.moodReasons !== undefined
      ? input.moodReasons
        ? JSON.stringify(input.moodReasons)
        : null
      : undefined;

  if (existing) {
    db.update(journalEntries)
      .set({ ...input, moodReasons, updatedAt: now, syncStatus: 'pending' })
      .where(eq(journalEntries.id, existing.id))
      .run();
    return { ...existing, ...input, updatedAt: now };
  }

  const entry: JournalEntry = {
    id: generateId(),
    entryDate: input.entryDate,
    body: input.body ?? '',
    mood: input.mood ?? null,
    energy: input.energy ?? null,
    stress: input.stress ?? null,
    focus: input.focus ?? null,
    sleepHours: input.sleepHours ?? null,
    sleepQuality: input.sleepQuality ?? null,
    moodReasons: input.moodReasons ?? null,
    locationLabel: input.locationLabel ?? null,
    locationLat: input.locationLat ?? null,
    locationLng: input.locationLng ?? null,
    createdAt: now,
    updatedAt: now,
  };
  db.insert(journalEntries)
    .values({
      ...entry,
      moodReasons: entry.moodReasons ? JSON.stringify(entry.moodReasons) : null,
      userId: LOCAL_USER_ID,
      syncStatus: 'pending',
    })
    .run();
  return entry;
}

export function deleteEntry(id: string) {
  getDb()
    .update(journalEntries)
    .set({ deletedAt: Date.now(), updatedAt: Date.now(), syncStatus: 'pending' })
    .where(eq(journalEntries.id, id))
    .run();
}

function toPrompt(row: typeof journalPrompts.$inferSelect): JournalPrompt {
  return {
    id: row.id,
    text: row.text,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
    isCustom: row.userId !== null,
  };
}

function seedDefaultPrompts() {
  const db = getDb();
  const now = Date.now();
  DEFAULT_PROMPTS.forEach((text, index) => {
    db.insert(journalPrompts)
      .values({
        id: generateId(),
        userId: null,
        text,
        isActive: true,
        sortOrder: index,
        createdAt: now,
      })
      .run();
  });
}

/** Seeds the five default reflection prompts on first use — system prompts have `userId: null`. */
export function listPrompts(): JournalPrompt[] {
  const db = getDb();
  const all = db
    .select()
    .from(journalPrompts)
    .where(
      and(
        or(isNull(journalPrompts.userId), eq(journalPrompts.userId, LOCAL_USER_ID)),
        isNull(journalPrompts.deletedAt),
      ),
    )
    .all();

  // Scoped to the system prompts specifically. "Are there any prompts at all"
  // was the same question until custom prompts started syncing: a second device
  // that pulls a custom prompt before this first runs would find a non-empty
  // table and never seed the five defaults, leaving the user with whichever
  // single prompt happened to arrive first.
  if (!all.some((row) => row.userId === null)) {
    seedDefaultPrompts();
    all.push(...db.select().from(journalPrompts).where(isNull(journalPrompts.userId)).all());
  }

  return all
    .filter((row) => row.isActive)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map(toPrompt);
}

export function createPrompt(text: string): JournalPrompt {
  const db = getDb();
  const now = Date.now();
  const maxSortOrder = db
    .select()
    .from(journalPrompts)
    .all()
    .reduce((max, row) => Math.max(max, row.sortOrder), -1);
  const prompt: JournalPrompt = {
    id: generateId(),
    text,
    isActive: true,
    sortOrder: maxSortOrder + 1,
    isCustom: true,
  };
  db.insert(journalPrompts)
    .values({
      id: prompt.id,
      userId: LOCAL_USER_ID,
      text,
      isActive: true,
      sortOrder: prompt.sortOrder,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return prompt;
}

export function deactivatePrompt(id: string) {
  getDb()
    .update(journalPrompts)
    .set({ isActive: false, updatedAt: Date.now() })
    .where(eq(journalPrompts.id, id))
    .run();
}

function toReflection(row: typeof journalReflections.$inferSelect): JournalReflection {
  return { id: row.id, entryId: row.entryId, promptId: row.promptId, answerText: row.answerText };
}

export function listReflectionsForEntry(entryId: string): JournalReflection[] {
  return getDb()
    .select()
    .from(journalReflections)
    .where(and(eq(journalReflections.entryId, entryId), isNull(journalReflections.deletedAt)))
    .all()
    .map(toReflection);
}

export function upsertReflection(entryId: string, promptId: string, answerText: string) {
  const db = getDb();
  const existing = db
    .select()
    .from(journalReflections)
    .where(and(eq(journalReflections.entryId, entryId), eq(journalReflections.promptId, promptId)))
    .get();

  if (existing) {
    db.update(journalReflections)
      .set({ answerText, deletedAt: null, updatedAt: Date.now() })
      .where(eq(journalReflections.id, existing.id))
      .run();
    return;
  }

  const now = Date.now();
  db.insert(journalReflections)
    .values({
      id: generateId(),
      entryId,
      promptId,
      answerText,
      userId: LOCAL_USER_ID,
      createdAt: now,
      updatedAt: now,
    })
    .run();
}

function toAttachment(row: typeof journalAttachments.$inferSelect): JournalAttachment {
  return {
    id: row.id,
    entryId: row.entryId,
    kind: row.kind,
    uri: row.uri,
    thumbnailUri: row.thumbnailUri,
    durationMs: row.durationMs,
    createdAt: row.createdAt,
  };
}

export function listAttachmentsForEntry(entryId: string): JournalAttachment[] {
  return getDb()
    .select()
    .from(journalAttachments)
    .where(and(eq(journalAttachments.entryId, entryId), isNull(journalAttachments.deletedAt)))
    .orderBy(journalAttachments.createdAt)
    .all()
    .map(toAttachment);
}

export function addAttachment(
  entryId: string,
  kind: JournalAttachment['kind'],
  uri: string,
  options: { thumbnailUri?: string | null; durationMs?: number | null } = {},
): JournalAttachment {
  const attachment: JournalAttachment = {
    id: generateId(),
    entryId,
    kind,
    uri,
    thumbnailUri: options.thumbnailUri ?? null,
    durationMs: options.durationMs ?? null,
    createdAt: Date.now(),
  };
  getDb()
    .insert(journalAttachments)
    .values({ ...attachment, userId: LOCAL_USER_ID, updatedAt: attachment.createdAt })
    .run();
  return attachment;
}

export function deleteAttachment(id: string) {
  const now = Date.now();
  getDb()
    .update(journalAttachments)
    .set({ deletedAt: now, updatedAt: now })
    .where(eq(journalAttachments.id, id))
    .run();
}
