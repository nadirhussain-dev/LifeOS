import { DatabaseSync } from 'node:sqlite';

import { bootstrapDatabase, type BootstrapTarget } from '@/database/bootstrap';
import * as schema from '@/database/schema';
import { ALL_SYNC_TABLES, SYNC_DEVICE_LOCAL_COLUMNS } from '@/features/sync/config/sync-tables';

type ColumnInfo = { name: string; notnull: number; dflt_value: string | null };

/**
 * Executes the local schema against a real SQLite, which nothing did before.
 *
 * The tests around this file all read schema.ts as *text* — which columns it
 * declares, which tables it names — and every one of them passed while the
 * bootstrap contained six statements SQLite refuses to parse:
 *
 *     updated_at INTEGER NOT NULL DEFAULT 0
 *     deleted_at INTEGER
 *
 * with no comma. A failing statement aborts the whole multi-statement exec, so
 * `getDb()` would have thrown on any device that did not already have the
 * tables, and the app would have had no database at all. Not one check in CI
 * could see it, because reading SQL is not running it.
 *
 * `node:sqlite` is the same engine expo-sqlite embeds. It is not the same
 * *build*, so this proves the SQL is valid and the migration path is coherent —
 * not that a particular Android version behaves identically.
 */

/** expo-sqlite's surface, narrowed to what the bootstrap uses. */
function open(): DatabaseSync & BootstrapTarget {
  const db = new DatabaseSync(':memory:');
  return Object.assign(db, {
    execSync: (sql: string) => db.exec(sql),
    getAllSync: <T>(sql: string) => db.prepare(sql).all() as T[],
  });
}

const tableNames = (db: DatabaseSync) =>
  (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[])
    .map((row) => row.name)
    .filter((name) => !name.startsWith('sqlite_'));

const columnsOf = (db: DatabaseSync, table: string) =>
  new Set(
    (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((row) => row.name),
  );

describe('local schema', () => {
  it('bootstraps a fresh database', () => {
    // The check that was missing. If any statement in TABLE_BOOTSTRAP_SQL,
    // BACKFILL_SQL or INDEX_BOOTSTRAP_SQL is invalid, this throws.
    const db = open();
    expect(() => bootstrapDatabase(db)).not.toThrow();
    expect(tableNames(db).length).toBeGreaterThan(35);
  });

  it('is idempotent — a second launch changes nothing', () => {
    const db = open();
    bootstrapDatabase(db);
    const before = tableNames(db).sort();
    expect(() => bootstrapDatabase(db)).not.toThrow();
    expect(tableNames(db).sort()).toEqual(before);
  });

  it('upgrades a database that predates every additive column', () => {
    // The path a real device takes. A table created before a column was added
    // is not touched by CREATE TABLE IF NOT EXISTS, so ADDITIVE_COLUMNS is the
    // only thing that gets the column there — and an ALTER with bad syntax
    // fails exactly as loudly as a bad CREATE.
    const db = open();

    // Build the "old" database: every table, minus every additive column.
    const additive = schema.ADDITIVE_COLUMNS as Record<string, { name: string }[]>;
    const legacy = stripColumns(schema.TABLE_BOOTSTRAP_SQL, additive);
    db.exec(legacy);

    for (const [table, columns] of Object.entries(additive)) {
      const present = columnsOf(db, table);
      for (const column of columns) {
        expect({ table, column: column.name, present: present.has(column.name) }).toEqual({
          table,
          column: column.name,
          present: false,
        });
      }
    }

    expect(() => bootstrapDatabase(db)).not.toThrow();

    for (const [table, columns] of Object.entries(additive)) {
      const present = columnsOf(db, table);
      for (const column of columns) {
        expect({ table, column: column.name, present: present.has(column.name) }).toEqual({
          table,
          column: column.name,
          present: true,
        });
      }
    }
  });

  it('gives every synced table the columns the engine reads, at runtime', () => {
    // The contract test asserts this from the source text. This asserts it from
    // the database that source text actually produces, which is the thing the
    // engine queries.
    const db = open();
    bootstrapDatabase(db);

    for (const table of ALL_SYNC_TABLES) {
      const columns = columnsOf(db, table.name);
      for (const required of [table.key ?? 'id', 'user_id', 'updated_at']) {
        expect({ table: table.name, required, has: columns.has(required) }).toEqual({
          table: table.name,
          required,
          has: true,
        });
      }
    }
  });

  it('runs the engine’s own queries against every synced table', () => {
    // The push predicate, verbatim. A table whose key column is missing or
    // misspelled parses fine as DDL and fails only here.
    const db = open();
    bootstrapDatabase(db);

    for (const table of ALL_SYNC_TABLES) {
      const key = table.key ?? 'id';
      expect(() =>
        db
          .prepare(
            `SELECT * FROM ${table.name}
              WHERE user_id = ? AND (updated_at > ? OR (updated_at = ? AND ${key} > ?))
              ORDER BY updated_at ASC, ${key} ASC LIMIT 1`,
          )
          .all('local', 0, 0, ''),
      ).not.toThrow();
    }
  });

  it('answers the engine’s row lookup from an index, not a scan', () => {
    // `applyRemoteRow` looks up one local row per row it pulls. Unindexed, a
    // thousand-row page is a thousand full table scans, inside a transaction,
    // on the main thread — quadratic work that only appears once somebody has
    // a few years of history. The index makes it a lookup; this asserts the
    // planner actually reaches for it.
    const db = open();
    bootstrapDatabase(db);

    for (const table of ALL_SYNC_TABLES) {
      const key = table.key ?? 'id';
      const plan = (
        db
          .prepare(`EXPLAIN QUERY PLAN SELECT updated_at FROM ${table.name} WHERE ${key} = ?`)
          .all('x') as { detail: string }[]
      )
        .map((row) => row.detail)
        .join(' ');

      expect({ table: table.name, plan, scans: plan.includes('SCAN') }).toEqual({
        table: table.name,
        plan,
        scans: false,
      });
    }
  });

  it('walks the engine’s change-detection order from an index', () => {
    // `SELECT ... WHERE user_id = ? AND (updated_at, key) > cursor ORDER BY
    // updated_at, key`. Without a matching index SQLite sorts the whole table
    // on every push, for every table, on every sync.
    const db = open();
    bootstrapDatabase(db);

    // The tables that actually grow: a log per day, per habit, per glass of
    // water. The small ones (categories, settings) are not worth an index.
    for (const table of [
      'tasks',
      'notes',
      'habit_logs',
      'habit_skips',
      'journal_entries',
      'water_intake_logs',
      'budget_transactions',
      'study_sessions',
      'goal_progress_logs',
      'gallery_photos',
      'songs',
    ]) {
      const plan = (
        db
          .prepare(
            `EXPLAIN QUERY PLAN
             SELECT * FROM ${table}
              WHERE user_id = ? AND (updated_at > ? OR (updated_at = ? AND id > ?))
              ORDER BY updated_at ASC, id ASC LIMIT 500`,
          )
          .all('local', 0, 0, '') as { detail: string }[]
      )
        .map((row) => row.detail)
        .join(' ');

      // No "USE TEMP B-TREE FOR ORDER BY" — that is the sort the index exists
      // to avoid, and it is the thing that would silently reappear if someone
      // reordered the index columns.
      expect({ table, plan, sorts: plan.includes('TEMP B-TREE') }).toEqual({
        table,
        plan,
        sorts: false,
      });
    }
  });

  it('accepts a pulled media row on a database that predates the column defaults', () => {
    // The bug this pins only exists on an UPGRADED device, which is to say on
    // every existing install and on no fresh one.
    //
    // `songs.uri` and the other media paths are device-local, so a row pulled
    // from another phone does not carry them. A fresh install is fine — the
    // current DDL declares them `NOT NULL DEFAULT ''`. But SQLite cannot add a
    // default to a column that already exists, so on an upgraded database they
    // are still the original `NOT NULL` with no default, and the INSERT is
    // refused. One refused row aborts the transaction, the transaction aborts
    // the pull, and the pull aborts every module after it.
    //
    // The engine reads `notnull`/`dflt_value` from PRAGMA table_info and fills
    // those columns itself. This asserts the shape it depends on.
    const db = open();

    // `songs` as it was actually shipped, before `uri` gained its default.
    // Written out rather than derived: stripColumns() removes columns, and the
    // thing that differs here is a column's *default*, which no transformation
    // of the current DDL can undo. This is the historical statement.
    db.exec(`
      CREATE TABLE songs (
        id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL,
        artist TEXT,
        uri TEXT NOT NULL,
        duration_ms INTEGER,
        added_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        deleted_at INTEGER
      );
    `);
    bootstrapDatabase(db);

    // CREATE TABLE IF NOT EXISTS left the old table alone, which is the whole
    // point — the device keeps the shape it had.
    expect(
      (db.prepare(`PRAGMA table_info(songs)`).all() as ColumnInfo[]).find((c) => c.name === 'uri'),
    ).toMatchObject({ notnull: 1, dflt_value: null });

    // `tableShape()` in the engine, computed the same way: a column it must
    // supply on INSERT is NOT NULL, has no default, and is device-local (so it
    // is never in a server payload).
    const fillOnInsert = (table: string) =>
      (db.prepare(`PRAGMA table_info(${table})`).all() as ColumnInfo[])
        .filter(
          (c) => c.notnull && c.dflt_value === null && SYNC_DEVICE_LOCAL_COLUMNS.includes(c.name),
        )
        .map((c) => c.name);

    // On an upgraded database `uri` is exactly that column. If this list is
    // ever empty here, either the engine has stopped needing to fill anything
    // (fine) or the upgrade path has quietly changed (not fine) — and the
    // insert below is what tells the two apart.
    expect(fillOnInsert('songs')).toContain('uri');

    // Without the fill — the pre-fix behaviour, kept as the reason this exists.
    expect(() =>
      db
        .prepare(
          `INSERT INTO songs (id, user_id, title, added_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run('s-unfilled', 'local', 'From another phone', 1, 1, 1),
    ).toThrow(/NOT NULL/);

    // With it — what the engine now does.
    expect(() =>
      db
        .prepare(
          `INSERT INTO songs (id, user_id, title, added_at, created_at, updated_at, uri)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run('s-pulled', 'local', 'From another phone', 1, 1, 1, ''),
    ).not.toThrow();

    // And '' is what the UI reads as "the bytes are on another device".
    expect(db.prepare(`SELECT uri FROM songs WHERE id = 's-pulled'`).get()).toEqual({ uri: '' });
  });

  it('backfills a derived id onto the join tables', () => {
    // Their id is not generated, it is composed from the pair they join — which
    // is what lets two devices that made the same link agree on one row. A row
    // inserted before the column existed has to acquire it on upgrade, or it
    // has no key to sync by at all.
    const db = open();
    db.exec(stripColumns(schema.TABLE_BOOTSTRAP_SQL, schema.ADDITIVE_COLUMNS));
    db.exec(`INSERT INTO note_tag_links (note_id, tag_id) VALUES ('note-1', 'tag-1')`);
    db.exec(`INSERT INTO habit_routine_items (routine_id, habit_id) VALUES ('r-1', 'h-1')`);
    db.exec(`INSERT INTO playlist_songs (playlist_id, song_id) VALUES ('p-1', 's-1')`);

    bootstrapDatabase(db);

    const row = (sql: string) => db.prepare(sql).get() as Record<string, unknown>;
    expect(row('SELECT id, user_id, updated_at FROM note_tag_links')).toEqual({
      id: 'note-1:tag-1',
      user_id: 'local',
      updated_at: 1,
    });
    expect(row('SELECT id FROM habit_routine_items')).toEqual({ id: 'r-1:h-1' });
    expect(row('SELECT id FROM playlist_songs')).toEqual({ id: 'p-1:s-1' });
  });

  it('backfills updated_at from created_at so old history is not invisible', () => {
    // A column added as NOT NULL DEFAULT 0 leaves every existing row at 0, and
    // the push predicate is `updated_at > cursor`. Without the backfill, every
    // habit tick a user ever recorded stays on their old phone.
    const db = open();
    db.exec(stripColumns(schema.TABLE_BOOTSTRAP_SQL, schema.ADDITIVE_COLUMNS));
    db.exec(
      `INSERT INTO habit_logs (id, habit_id, user_id, log_date, value, logged_at, created_at)
        VALUES ('log-1', 'h-1', 'local', '2026-01-01', 1, 1700000000000, 1700000000000)`,
    );

    bootstrapDatabase(db);

    expect(db.prepare('SELECT updated_at FROM habit_logs').get()).toEqual({
      updated_at: 1700000000000,
    });
  });
});

/**
 * Rewrites the bootstrap DDL as it looked before a set of columns existed, so a
 * test can build the database an upgrading device is actually starting from.
 */
function stripColumns(sql: string, additive: Record<string, { name: string }[]>): string {
  let out = sql;
  for (const [table, columns] of Object.entries(additive)) {
    out = out.replace(
      new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(([\\s\\S]*?)\\n  \\);`),
      (whole, body: string) => {
        const names = new Set(columns.map((column) => column.name));
        const kept = body
          .split('\n')
          .filter((line) => !names.has(line.trim().split(/[\s(]/)[0].replace(/,$/, '')));
        // Removing the last column definition leaves a dangling comma on the
        // one before it — the same syntax error this whole file exists to catch.
        const cleaned = kept.join('\n').replace(/,(\s*)$/, '$1');
        return `CREATE TABLE IF NOT EXISTS ${table} (${cleaned}\n  );`;
      },
    );
  }
  return out;
}

describe('full-text search index', () => {
  /**
   * FTS5 is a compile-time SQLite option, so these assertions are as much about
   * the *guard* as the feature: the index lives outside TABLE_BOOTSTRAP_SQL
   * precisely so that a build without FTS5 loses search rather than the whole
   * database.
   */
  it('indexes notes that already existed', () => {
    const db = open();
    bootstrapDatabase(db);
    db.exec(`
      INSERT INTO notes (id, user_id, title, body, created_at, updated_at)
      VALUES ('n1', 'local', 'Kitchen renovation', 'quotes from three builders', 1, 1);
    `);
    // Re-running bootstrap is what a relaunch does, and the backfill has to pick
    // up a note written before the index existed.
    bootstrapDatabase(db);

    const rows = db
      .prepare(`SELECT note_id FROM notes_fts WHERE notes_fts MATCH ?`)
      .all('"builders"*') as { note_id: string }[];
    expect(rows.map((row) => row.note_id)).toEqual(['n1']);
  });

  it('keeps the index in step with writes', () => {
    const db = open();
    bootstrapDatabase(db);
    db.exec(`
      INSERT INTO notes (id, user_id, title, body, created_at, updated_at)
      VALUES ('n2', 'local', 'Draft', 'aardvark', 1, 1);
    `);

    const matches = (term: string) =>
      (
        db.prepare(`SELECT note_id FROM notes_fts WHERE notes_fts MATCH ?`).all(term) as {
          note_id: string;
        }[]
      ).length;

    expect(matches('"aardvark"*')).toBe(1);

    db.exec(`UPDATE notes SET body = 'buffalo' WHERE id = 'n2';`);
    expect(matches('"aardvark"*')).toBe(0);
    expect(matches('"buffalo"*')).toBe(1);

    db.exec(`DELETE FROM notes WHERE id = 'n2';`);
    expect(matches('"buffalo"*')).toBe(0);
  });

  it('does not double-index a note on a second launch', () => {
    // The backfill runs every launch, so its NOT EXISTS clause is the only thing
    // stopping every note appearing twice in search after a week of use.
    const db = open();
    bootstrapDatabase(db);
    db.exec(`
      INSERT INTO notes (id, user_id, title, body, created_at, updated_at)
      VALUES ('n3', 'local', 'Once', 'unique-term', 1, 1);
    `);
    bootstrapDatabase(db);
    bootstrapDatabase(db);

    const rows = db
      .prepare(`SELECT note_id FROM notes_fts WHERE notes_fts MATCH ?`)
      .all('"unique-term"*') as { note_id: string }[];
    expect(rows).toHaveLength(1);
  });
});
