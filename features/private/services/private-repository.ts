import { and, eq, isNull } from 'drizzle-orm';

import { getDb } from '@/database/client';
import { privateEntries } from '@/database/schema';
import type { PrivateModuleId } from '@/features/private/config/private-modules';
import { encryptString, tryDecryptString } from '@/features/private/services/vault-crypto';
import { vaultKey } from '@/features/private/store/private-store';
import { generateId } from '@/lib/id';
import { LOCAL_USER_ID } from '@/lib/local-user';

/**
 * CRUD for every private module, over one encrypted table.
 *
 * Reads decrypt the whole table and filter in memory. That is not an oversight
 * — the module id and the date are inside the ciphertext precisely so they
 * cannot be used as a WHERE clause by us or by anyone reading the file, and at
 * these row counts (hundreds, over years) the cost is invisible.
 *
 * A row that will not open under the current key is skipped in silence, which
 * is how the real and decoy spaces share one table with nothing on disk
 * distinguishing them.
 *
 * Every function here returns empty / no-ops while locked. Callers do not need
 * to check, and a screen left mounted through a lock cannot keep reading.
 */

/** The stable part of every private record. Modules add their own fields. */
export type PrivateRecordBase = {
  id: string;
  module: PrivateModuleId;
  createdAt: number;
  updatedAt: number;
};

export type PrivateRecord<T = Record<string, unknown>> = PrivateRecordBase & T;

type StoredPayload = { module: PrivateModuleId } & Record<string, unknown>;

/** Reads and decrypts everything belonging to one module, newest first. */
export function listPrivateRecords<T = Record<string, unknown>>(
  module: PrivateModuleId,
): PrivateRecord<T>[] {
  const key = vaultKey();
  if (!key) return [];

  const rows = getDb()
    .select()
    .from(privateEntries)
    .where(and(eq(privateEntries.userId, LOCAL_USER_ID), isNull(privateEntries.deletedAt)))
    .all();

  const out: PrivateRecord<T>[] = [];
  for (const row of rows) {
    const plain = tryDecryptString(key, row.payload);
    // Belongs to the other space, or predates a destroyed key. Not an error.
    if (plain === null) continue;

    let payload: StoredPayload;
    try {
      payload = JSON.parse(plain) as StoredPayload;
    } catch {
      continue;
    }
    if (payload.module !== module) continue;

    const { module: _module, ...fields } = payload;
    out.push({
      ...(fields as T),
      id: row.id,
      module,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }

  return out.sort((a, b) => b.createdAt - a.createdAt);
}

export function getPrivateRecord<T = Record<string, unknown>>(
  module: PrivateModuleId,
  id: string,
): PrivateRecord<T> | null {
  return listPrivateRecords<T>(module).find((r) => r.id === id) ?? null;
}

/** Seals `fields` under the current key and stores them. Returns the new id. */
export function createPrivateRecord(
  module: PrivateModuleId,
  fields: Record<string, unknown>,
): string | null {
  const key = vaultKey();
  if (!key) return null;

  const now = Date.now();
  const id = generateId();
  getDb()
    .insert(privateEntries)
    .values({
      id,
      userId: LOCAL_USER_ID,
      payload: encryptString(key, JSON.stringify({ module, ...fields })),
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return id;
}

/**
 * Rewrites a record. Reads the existing one first so a partial update does not
 * silently drop the fields it did not mention — and re-seals with a fresh
 * nonce, so two versions of the same row never share one.
 */
export function updatePrivateRecord(
  module: PrivateModuleId,
  id: string,
  fields: Record<string, unknown>,
): boolean {
  const key = vaultKey();
  if (!key) return false;

  const existing = getPrivateRecord(module, id);
  if (!existing) return false;

  const {
    id: _id,
    module: _module,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    ...rest
  } = existing;

  getDb()
    .update(privateEntries)
    .set({
      payload: encryptString(key, JSON.stringify({ module, ...rest, ...fields })),
      updatedAt: Date.now(),
    })
    .where(eq(privateEntries.id, id))
    .run();
  return true;
}

/**
 * Deletes for real, not a tombstone.
 *
 * Everywhere else in Daykeep a delete is soft, so it can propagate to another
 * device. Here the row is removed outright: a tombstone in a private table is a
 * record that something existed and was deleted, which is its own disclosure —
 * and the encrypted payload would still be sitting on disk. Sync for these
 * modules is off by default for the same reason.
 */
export function deletePrivateRecord(id: string): void {
  if (!vaultKey()) return;
  getDb().delete(privateEntries).where(eq(privateEntries.id, id)).run();
}

/** Deletes every record of one module — used when a module is switched off. */
export function deleteModuleRecords(module: PrivateModuleId): void {
  for (const record of listPrivateRecords(module)) deletePrivateRecord(record.id);
}

/** Wipes the table outright, both spaces. Used when the private space is
 * destroyed; the rows are unreadable without the keys anyway, but leaving
 * ciphertext lying around after "delete everything" is not what was asked. */
export function deleteAllPrivateRecords(): void {
  getDb().delete(privateEntries).where(eq(privateEntries.userId, LOCAL_USER_ID)).run();
}

/** How many records each module holds, for the space's overview. Counts only
 * what the current key can open. */
export function privateRecordCounts(): Record<string, number> {
  const key = vaultKey();
  if (!key) return {};

  const rows = getDb()
    .select()
    .from(privateEntries)
    .where(and(eq(privateEntries.userId, LOCAL_USER_ID), isNull(privateEntries.deletedAt)))
    .all();

  const counts: Record<string, number> = {};
  for (const row of rows) {
    const plain = tryDecryptString(key, row.payload);
    if (plain === null) continue;
    try {
      const { module } = JSON.parse(plain) as StoredPayload;
      counts[module] = (counts[module] ?? 0) + 1;
    } catch {
      // Unparseable payload: nothing to count, nothing to report.
    }
  }
  return counts;
}
