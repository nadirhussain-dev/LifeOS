import { getRawDb } from '@/database/client';
import { generateId } from '@/lib/id';

/**
 * The record of what last-write-wins threw away.
 *
 * Raw SQL rather than drizzle, matching the sync engine itself: the engine works
 * in generic table names and column maps, and a typed query builder buys nothing
 * where the table is a variable.
 */
export type SyncConflict = {
  id: string;
  tableName: string;
  rowKey: string;
  module: string;
  /** The local row as it was immediately before being overwritten. */
  localSnapshot: Record<string, unknown>;
  localUpdatedAt: number;
  remoteUpdatedAt: number;
  resolvedAt: number | null;
  resolution: 'restored' | 'kept_remote' | null;
  createdAt: number;
};

type ConflictRow = {
  id: string;
  table_name: string;
  row_key: string;
  module: string;
  local_snapshot: string;
  local_updated_at: number;
  remote_updated_at: number;
  resolved_at: number | null;
  resolution: 'restored' | 'kept_remote' | null;
  created_at: number;
};

function toConflict(row: ConflictRow): SyncConflict {
  let snapshot: Record<string, unknown> = {};
  try {
    snapshot = JSON.parse(row.local_snapshot) as Record<string, unknown>;
  } catch {
    // A snapshot we cannot parse is a conflict we cannot offer to restore, but
    // it is still worth showing that something was overwritten.
  }
  return {
    id: row.id,
    tableName: row.table_name,
    rowKey: row.row_key,
    module: row.module,
    localSnapshot: snapshot,
    localUpdatedAt: row.local_updated_at,
    remoteUpdatedAt: row.remote_updated_at,
    resolvedAt: row.resolved_at,
    resolution: row.resolution,
    createdAt: row.created_at,
  };
}

/**
 * Records one overwrite.
 *
 * Called from inside the pull transaction, so a page that rolls back does not
 * leave a conflict row describing an overwrite that never happened.
 *
 * Re-recording the same row replaces the open conflict rather than adding a
 * second. Two devices editing one note back and forth for a week should leave
 * one entry offering the version this device last had, not seven — and the
 * newest snapshot is the only one anybody would want back.
 */
export function recordConflict(input: {
  tableName: string;
  rowKey: string;
  module: string;
  localSnapshot: Record<string, unknown>;
  localUpdatedAt: number;
  remoteUpdatedAt: number;
}): void {
  const raw = getRawDb();
  raw.runSync(
    `DELETE FROM sync_conflicts
      WHERE table_name = ? AND row_key = ? AND resolved_at IS NULL`,
    [input.tableName, input.rowKey],
  );
  raw.runSync(
    `INSERT INTO sync_conflicts
       (id, table_name, row_key, module, local_snapshot,
        local_updated_at, remote_updated_at, resolved_at, resolution, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)`,
    [
      generateId(),
      input.tableName,
      input.rowKey,
      input.module,
      JSON.stringify(input.localSnapshot),
      input.localUpdatedAt,
      input.remoteUpdatedAt,
      Date.now(),
    ],
  );
}

export function listOpenConflicts(): SyncConflict[] {
  const raw = getRawDb();
  try {
    return raw
      .getAllSync<ConflictRow>(
        `SELECT * FROM sync_conflicts WHERE resolved_at IS NULL ORDER BY created_at DESC`,
      )
      .map(toConflict);
  } catch {
    // The table not existing yet (a build older than this one) must not break
    // the settings screen that asks.
    return [];
  }
}

export function openConflictCount(): number {
  const raw = getRawDb();
  try {
    const row = raw.getFirstSync<{ n: number }>(
      `SELECT count(*) AS n FROM sync_conflicts WHERE resolved_at IS NULL`,
    );
    return row?.n ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Puts the local version back.
 *
 * Deliberately written as a *fresh edit* — `updated_at` is stamped to now — so
 * the next push carries it to the server and the other device converges on it.
 * Restoring by writing the old timestamp would look correct locally and be
 * silently undone by the very next pull, which is the worst of both.
 *
 * Columns are intersected with the table's current shape, because a snapshot
 * taken before an app update can name a column that no longer exists.
 */
export function restoreConflict(conflict: SyncConflict, keyColumn = 'id'): boolean {
  const raw = getRawDb();
  const columns = new Set(
    raw.getAllSync<{ name: string }>(`PRAGMA table_info(${conflict.tableName})`).map((c) => c.name),
  );

  const assignments = Object.keys(conflict.localSnapshot).filter(
    (column) => columns.has(column) && column !== keyColumn && column !== 'updated_at',
  );
  if (assignments.length === 0) return false;

  raw.runSync(
    `UPDATE ${conflict.tableName}
        SET ${assignments.map((c) => `${c} = ?`).join(', ')}, updated_at = ?
      WHERE ${keyColumn} = ?`,
    [
      ...assignments.map((c) => conflict.localSnapshot[c] as never),
      Date.now() as never,
      conflict.rowKey as never,
    ],
  );
  resolveConflict(conflict.id, 'restored');
  return true;
}

export function resolveConflict(id: string, resolution: 'restored' | 'kept_remote'): void {
  getRawDb().runSync(`UPDATE sync_conflicts SET resolved_at = ?, resolution = ? WHERE id = ?`, [
    Date.now(),
    resolution,
    id,
  ]);
}

export function resolveAllConflicts(resolution: 'kept_remote'): void {
  getRawDb().runSync(
    `UPDATE sync_conflicts SET resolved_at = ?, resolution = ? WHERE resolved_at IS NULL`,
    [Date.now(), resolution],
  );
}
