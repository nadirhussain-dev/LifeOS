import { getRawDb } from '@/database/client';
import { trackModuleWrites } from '@/features/analytics/store/usage-store';
import { useAuthStore } from '@/features/auth/services/auth-store';
import { uploadPendingMedia } from '@/features/media-sync/services/media-uploader';
import { currentStatus } from '@/features/moderation/services/account-standing';
import { recordConflict } from '@/features/sync/services/conflict-repository';
import {
  SYNC_DEVICE_LOCAL_COLUMNS,
  SYNC_MODULES,
  type SyncModule,
  type SyncTable,
} from '@/features/sync/config/sync-tables';
import {
  cursorKey,
  parseCursor,
  useSyncStore,
  type SyncCursor,
} from '@/features/sync/store/sync-store';
import { LOCAL_USER_ID } from '@/lib/local-user';
import { supabase } from '@/lib/supabase';

/**
 * Offline-first sync engine.
 *
 * The local DB is always single-user (`user_id = 'local'`); the engine swaps
 * `'local' ↔ the authenticated uid` at the Supabase boundary, so a guest's
 * existing rows upload to their account automatically on first sync (no
 * migration pass). Conflict resolution is last-write-wins by `updated_at`.
 * See features/sync/config/sync-tables.ts for which tables participate.
 *
 * ## Why the cursors are pairs, not timestamps
 *
 * Change detection is a high-water mark per table, and it used to be the plain
 * `max(updated_at)` seen so far, with each run fetching `updated_at > cursor`.
 * That is correct only while no two rows share a timestamp — and `updated_at`
 * is milliseconds, written by loops that insert many rows inside the same
 * millisecond (a habit backfill, an import, the initial upload of an existing
 * account). Once more rows share one millisecond than fit in a page, the
 * pagination cannot advance: the next request asks for `> cursor` and skips
 * every remaining row at exactly `cursor`. Those rows are then invisible to
 * sync permanently — no error, no retry, they simply never travel.
 *
 * So the cursor is the pair `(updated_at, key)` and the predicate is the
 * lexicographic "greater than that pair". Ties are broken by a column that is
 * unique by construction, so every row has exactly one position in the order
 * and the walk always terminates.
 *
 * ## Why pages exist at all
 *
 * PostgREST caps a response at its configured maximum (1000 rows by default)
 * whether or not you ask it to. The previous code took whatever came back as
 * "everything that changed", so an account with more than a page of history
 * silently synced one page per app launch. Both directions now loop until a
 * short page proves the end was reached.
 */

type Row = Record<string, unknown>;

/** Rows per upsert request. Large enough that a normal sync is one round trip,
 * small enough that the request body stays well inside any gateway's limit and
 * a failure costs one batch rather than the whole table. */
const PUSH_CHUNK = 500;

/** Rows per pull request. PostgREST will not return more than its own maximum
 * regardless; asking for a bounded page is what makes the loop's termination
 * condition ("a short page means the end") meaningful. */
const PULL_PAGE = 1000;

/** The device-local column set, as a Set for per-row lookups. */
const DEVICE_LOCAL = new Set(SYNC_DEVICE_LOCAL_COLUMNS);

type ColumnInfo = { name: string; type: string; notnull: number; dflt_value: string | null };

type TableShape = {
  /** Every column the local table has. */
  columns: Set<string>;
  /**
   * Columns an INSERT must name because the table will refuse it otherwise:
   * NOT NULL, no default, and never present in a server payload.
   *
   * This exists because of an upgrade, not a design. `songs.uri` and the other
   * media paths are device-local, so a pulled row does not carry them — and on
   * a *fresh* install that is fine, because the current DDL declares them
   * `NOT NULL DEFAULT ''`. On a device that already had the table, the column
   * is still the original `TEXT NOT NULL` with no default, and SQLite cannot
   * add one to an existing column. So the first pull of a photo or a song on
   * every existing install would have failed with a NOT NULL constraint error
   * and aborted the entire sync — for upgrading users only, which is the worst
   * possible distribution of a bug.
   *
   * Read from the database rather than hard-coded, so this stays right for any
   * column that ends up in the same position later.
   */
  fillOnInsert: Map<string, string | number>;
};

const shapeCache = new Map<string, TableShape>();

function tableShape(table: string): TableShape {
  const cached = shapeCache.get(table);
  if (cached) return cached;

  const info = getRawDb().getAllSync<ColumnInfo>(`PRAGMA table_info(${table})`);
  const fillOnInsert = new Map<string, string | number>();
  for (const column of info) {
    if (!column.notnull || column.dflt_value !== null) continue;
    if (!DEVICE_LOCAL.has(column.name)) continue;
    // TEXT columns take '', numerics take 0 — the same values the current DDL
    // declares as their defaults, so a fresh install and an upgraded one end up
    // holding the identical row. '' is also exactly what `isOnThisDevice` reads
    // as "the bytes are somewhere else".
    fillOnInsert.set(column.name, /INT|REAL|NUM|DOUB|FLOA/i.test(column.type) ? 0 : '');
  }

  const shape: TableShape = { columns: new Set(info.map((c) => c.name)), fillOnInsert };
  shapeCache.set(table, shape);
  return shape;
}

/**
 * Cursors are accumulated here and written to the persisted store once, at the
 * end of a run.
 *
 * `setCursor` triggers a zustand persist, and persisting means serialising the
 * whole store and handing it to AsyncStorage. Doing that twice per table meant
 * ~70 serialise-and-write round trips per sync on the main thread, for a value
 * nothing reads until the next run.
 */
type CursorBatch = Map<string, SyncCursor>;

/** Lexicographic "after this (updated_at, key)" — see the header comment. */
function afterCursor(cursor: SyncCursor, keyColumn: string): { sql: string; params: unknown[] } {
  return {
    sql: `(updated_at > ? OR (updated_at = ? AND ${keyColumn} > ?))`,
    params: [cursor.at, cursor.at, cursor.key],
  };
}

/**
 * Uploads local rows changed since the last push for one table, a page at a
 * time. Returns how many rows moved, which is also the app's measure of
 * "writes" per module — see the rollup in runSync().
 */
async function pushTable(
  uid: string,
  table: SyncTable,
  cursors: CursorBatch,
  /**
   * Filled with the key of every row this run uploaded.
   *
   * This is what makes conflict detection precise. Push runs immediately before
   * pull for the same table, so a key in here is a row *this device edited since
   * it last synced* — and if the pull then brings back something newer for that
   * same key, the local edit is genuinely being thrown away. Without it, every
   * ordinary remote update would look like a conflict, since "local is older
   * than remote" is the normal case for a row somebody else changed.
   */
  pushedKeys: Set<string>,
): Promise<number> {
  const raw = getRawDb();
  const keyColumn = table.key ?? 'id';
  let cursor = cursors.get(cursorKey('push', table.name)) ?? { at: 0, key: '' };
  let moved = 0;

  for (;;) {
    const { sql, params } = afterCursor(cursor, keyColumn);
    const rows = raw.getAllSync<Row>(
      `SELECT * FROM ${table.name}
        WHERE user_id = ? AND ${sql}
        ORDER BY updated_at ASC, ${keyColumn} ASC
        LIMIT ?`,
      [LOCAL_USER_ID, ...(params as never[]), PUSH_CHUNK],
    );
    if (rows.length === 0) break;

    const payload = rows.map((row) => {
      const out: Row = {};
      for (const [column, value] of Object.entries(row)) {
        if (DEVICE_LOCAL.has(column)) continue;
        out[column] = value;
      }
      out.user_id = uid;
      return out;
    });

    const { error } = await supabase
      .from(table.name)
      .upsert(payload, { onConflict: keyColumn === 'user_id' ? 'user_id' : 'id' });
    if (error) throw new Error(`push ${table.name}: ${error.message}`);

    for (const row of rows) pushedKeys.add(String(row[keyColumn] ?? ''));

    const last = rows[rows.length - 1];
    cursor = { at: Number(last.updated_at ?? 0), key: String(last[keyColumn] ?? '') };
    cursors.set(cursorKey('push', table.name), cursor);
    moved += rows.length;

    if (rows.length < PUSH_CHUNK) break;
  }

  return moved;
}

/**
 * Downloads server rows changed since the last pull for one table, applying
 * each only if it is newer than the local copy (last-write-wins).
 */
async function pullTable(
  uid: string,
  table: SyncTable,
  cursors: CursorBatch,
  pushedKeys: Set<string>,
  moduleKey: string,
): Promise<void> {
  const raw = getRawDb();
  const keyColumn = table.key ?? 'id';
  const shape = tableShape(table.name);
  let cursor = cursors.get(cursorKey('pull', table.name)) ?? { at: 0, key: '' };

  for (;;) {
    const { data, error } = await supabase
      .from(table.name)
      .select('*')
      .eq('user_id', uid)
      // The lexicographic tuple comparison, in PostgREST's filter language.
      .or(
        `updated_at.gt.${cursor.at},and(updated_at.eq.${cursor.at},${keyColumn}.gt.${JSON.stringify(cursor.key)})`,
      )
      .order('updated_at', { ascending: true })
      .order(keyColumn, { ascending: true })
      .limit(PULL_PAGE);
    if (error) throw new Error(`pull ${table.name}: ${error.message}`);
    if (!data || data.length === 0) break;

    const rows = data as Row[];
    // One transaction per page: ~1000 individual commits become one, and a
    // page either lands whole or not at all, so an interrupted sync cannot
    // leave a child row referring to a parent that never arrived.
    raw.execSync('BEGIN');
    try {
      for (const remote of rows) {
        applyRemoteRow(table, remote, shape, keyColumn, pushedKeys, moduleKey);
      }
      raw.execSync('COMMIT');
    } catch (e) {
      raw.execSync('ROLLBACK');
      throw e;
    }

    const last = rows[rows.length - 1];
    cursor = { at: Number(last.updated_at ?? 0), key: String(last[keyColumn] ?? '') };
    cursors.set(cursorKey('pull', table.name), cursor);

    if (rows.length < PULL_PAGE) break;
  }
}

/**
 * Writes one server row into the local table.
 *
 * Existing rows are UPDATEd rather than replaced. `INSERT OR REPLACE` deletes
 * the old row and inserts a new one, which resets every column the new row does
 * not name — and the columns it does not name are exactly the ones that must
 * survive: this device's notification handles and its local file paths. A photo
 * pulled after an edit on another phone would have kept its caption and lost
 * the file it points at.
 */
function applyRemoteRow(
  table: SyncTable,
  remote: Row,
  shape: TableShape,
  keyColumn: string,
  pushedKeys: Set<string>,
  moduleKey: string,
) {
  const raw = getRawDb();
  const key = remote[keyColumn] as string;
  const lookup = keyColumn === 'user_id' ? LOCAL_USER_ID : key;

  const local = raw.getFirstSync<{ updated_at: number | null }>(
    `SELECT updated_at FROM ${table.name} WHERE ${keyColumn} = ?`,
    [lookup],
  );
  // Last-write-wins: skip if the local copy is the same age or newer.
  if (local && Number(local.updated_at ?? 0) >= Number(remote.updated_at ?? 0)) return;

  /**
   * About to overwrite a row this device edited since its last sync.
   *
   * Last-write-wins still wins — this only records what it discarded, so the
   * user can be told and can ask for it back. The full local row is read only
   * here, on the rare path, rather than widening the cheap existence check
   * above into a `SELECT *` on every pulled row.
   *
   * Inside the caller's transaction, so a page that rolls back cannot leave a
   * conflict describing an overwrite that never happened.
   */
  if (local && pushedKeys.has(String(remote[keyColumn] ?? ''))) {
    const snapshot = raw.getFirstSync<Row>(`SELECT * FROM ${table.name} WHERE ${keyColumn} = ?`, [
      lookup,
    ]);
    if (snapshot) {
      recordConflict({
        tableName: table.name,
        rowKey: String(lookup),
        module: moduleKey,
        localSnapshot: snapshot,
        localUpdatedAt: Number(local.updated_at ?? 0),
        remoteUpdatedAt: Number(remote.updated_at ?? 0),
      });
    }
  }

  const row: Row = { ...remote, user_id: LOCAL_USER_ID };
  const writable = Object.keys(row).filter((c) => shape.columns.has(c) && !DEVICE_LOCAL.has(c));

  if (local) {
    const assignments = writable.filter((c) => c !== keyColumn);
    if (assignments.length === 0) return;
    raw.runSync(
      `UPDATE ${table.name} SET ${assignments.map((c) => `${c} = ?`).join(', ')}
        WHERE ${keyColumn} = ?`,
      [...assignments.map((c) => row[c] as never), lookup as never],
    );
    return;
  }

  // Only on INSERT: an existing row already holds this device's own value for
  // these columns, and an update must never clear it.
  const insertColumns = [...writable];
  const values: unknown[] = writable.map((c) => row[c]);
  for (const [column, fallback] of shape.fillOnInsert) {
    if (insertColumns.includes(column)) continue;
    insertColumns.push(column);
    values.push(fallback);
  }

  raw.runSync(
    `INSERT INTO ${table.name} (${insertColumns.join(', ')})
      VALUES (${insertColumns.map(() => '?').join(', ')})`,
    values as never[],
  );
}

let inFlight: Promise<void> | null = null;

/**
 * Runs a full sync (deduped — concurrent calls share one run). No-ops for
 * guests. Never throws; failures land in the store's `status`/`lastError`.
 *
 * `force` is the manual "Sync now" button: it bypasses the throttle and the
 * backoff, because a person who just tapped the button is entitled to a
 * request even if the last one failed a moment ago.
 */
export function syncNow(options: { force?: boolean } = {}): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = runSync(options.force ?? false).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/**
 * A final push, for an account that is about to have its local data wiped.
 *
 * Push only, and it ignores the blocked-account check that `runSync` starts
 * with — because this runs precisely when the account IS blocked. The server
 * still decides: migration 0019 opens a short `evacuation_until` window when an
 * admin blocks somebody, and outside that window every one of these requests is
 * refused by RLS. So this is not a way around the block; it is the client half
 * of a window the server opened deliberately, so that a wipe does not destroy
 * data the cloud never received.
 *
 * Returns the modules it could not save. Those are the ones the user had sync
 * switched OFF for: an evacuation does not override that choice, because
 * consent to upload is not something a block should be able to revoke
 * retroactively — and the person is owed an accurate list of what is about to
 * be lost rather than a reassuring one.
 */
export async function evacuateBeforeWipe(): Promise<{ pushed: number; unsaved: SyncModule[] }> {
  const uid = useAuthStore.getState().user?.id;
  if (!uid) return { pushed: 0, unsaved: [] };

  const store = useSyncStore.getState();
  const cursors: CursorBatch = new Map();
  for (const [key, value] of Object.entries(store.cursors)) {
    cursors.set(key, parseCursor(value));
  }

  let pushed = 0;
  const unsaved: SyncModule[] = [];

  for (const mod of SYNC_MODULES) {
    if (!(store.modules[mod.key] ?? false)) {
      if (moduleHasRows(mod)) unsaved.push(mod.key);
      continue;
    }
    try {
      for (const table of mod.tables) {
        // Discarded: an evacuation only pushes, and nothing pulls afterwards to
        // overwrite anything, so there is no conflict to detect.
        pushed += await pushTable(uid, table, cursors, new Set());
      }
    } catch {
      // Best effort by design. A module that fails to upload — the window has
      // closed, the network dropped — is reported as unsaved rather than
      // aborting the evacuation and taking the modules after it down too.
      unsaved.push(mod.key);
    }
  }

  useSyncStore.getState().commitCursors(cursors);
  return { pushed, unsaved };
}

/** Whether this module has anything on the device worth mentioning as lost. */
function moduleHasRows(mod: (typeof SYNC_MODULES)[number]): boolean {
  const raw = getRawDb();
  return mod.tables.some((table) => {
    const row = raw.getFirstSync<{ n: number }>(
      `SELECT 1 AS n FROM ${table.name} WHERE user_id = ? AND deleted_at IS NULL LIMIT 1`,
      [LOCAL_USER_ID],
    );
    return row != null;
  });
}

/** Shortest gap between two automatic syncs. Foreground events can arrive in
 * bursts (a notification tap, a share sheet closing, the app being switched
 * back and forth), and each one used to start a full run. */
const MIN_AUTO_SYNC_INTERVAL_MS = 60_000;

/** Backoff ceiling after repeated failures. A device that cannot reach the
 * server retries at a rate that is useful to it and negligible to the server;
 * ten million of them retrying on every foreground event is not. */
const MAX_BACKOFF_MS = 30 * 60_000;

function backoffFor(consecutiveFailures: number): number {
  const base = Math.min(MAX_BACKOFF_MS, 30_000 * 2 ** (consecutiveFailures - 1));
  // Full jitter. Without it every device that failed during the same outage
  // comes back at the same instant the outage ends.
  return Math.round(base * (0.5 + Math.random() * 0.5));
}

async function runSync(force: boolean): Promise<void> {
  const uid = useAuthStore.getState().user?.id;
  if (!uid) return; // guests keep everything local

  const store = useSyncStore.getState();

  if (!force) {
    const now = Date.now();
    if (store.nextAttemptAt && now < store.nextAttemptAt) return;
    if (store.lastSyncedAt && now - store.lastSyncedAt < MIN_AUTO_SYNC_INTERVAL_MS) return;
  }

  // A blocked account is refused server-side anyway; stopping here turns a
  // string of RLS rejections into one honest status the Sync screen can show.
  // Only `blocked` — a restricted account has lost its reach into other
  // people's groups, not the right to back up its own data.
  if (currentStatus() === 'blocked') {
    useSyncStore.getState().setStatus('error', 'This account is blocked. Sync is paused.');
    return;
  }

  store.setStatus('syncing');

  // Seeded from the persisted cursors, mutated during the run, written back
  // once at the end — including on failure, so the tables that did complete
  // are not re-fetched from scratch on the next attempt.
  const cursors: CursorBatch = new Map();
  for (const [key, value] of Object.entries(store.cursors)) {
    cursors.set(key, parseCursor(value));
  }

  try {
    for (const mod of SYNC_MODULES) {
      if (!(store.modules[mod.key] ?? false)) continue;
      // Bail out if the session ended mid-run: the remaining requests would
      // fail anyway, and a wipe may already be underway.
      if (useAuthStore.getState().user?.id !== uid) return;

      // "Writes" is measured from what actually reached the server rather than
      // from instrumenting every mutation in every module: one place to be
      // right, and it counts real content rather than button presses.
      let pushed = 0;
      for (const table of mod.tables) {
        // Per table, and discarded after: the set only means anything for the
        // pull that immediately follows its own push.
        const pushedKeys = new Set<string>();
        pushed += await pushTable(uid, table, cursors, pushedKeys);
        await pullTable(uid, table, cursors, pushedKeys, mod.key);
      }
      if (pushed > 0) trackModuleWrites(mod.key, pushed);
    }
    useSyncStore.getState().commitCursors(cursors);
    useSyncStore.getState().setStatus('idle');
    useSyncStore.getState().setLastSyncedAt(Date.now());
    useSyncStore.getState().setNextAttemptAt(null);

    /**
     * Bytes last, and outside the try that owns sync's status.
     *
     * Media is the least urgent thing here and the most likely to fail — a big
     * file, a slow connection, a quota. Running it after the cursors are
     * committed and the status is `idle` means an upload problem cannot make a
     * successful row sync look failed, and cannot roll back cursors that
     * legitimately advanced. It no-ops unless the user opted in.
     */
    void uploadPendingMedia().catch(() => undefined);
  } catch (e) {
    const failures = useSyncStore.getState().consecutiveFailures + 1;
    useSyncStore.getState().commitCursors(cursors);
    useSyncStore.getState().setStatus('error', e instanceof Error ? e.message : 'Sync failed');
    useSyncStore.getState().setNextAttemptAt(Date.now() + backoffFor(failures));
  }
}
