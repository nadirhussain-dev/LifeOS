import { drizzle } from 'drizzle-orm/expo-sqlite';

import { bootstrapDatabase, type BootstrapTarget } from '@/database/bootstrap';
import * as schema from '@/database/schema';
import { getOrCreateDbKey } from '@/features/security/lib/db-key';

/**
 * The app's local database, encrypted at rest with SQLCipher.
 *
 * ## Why this is not expo-sqlite any more
 *
 * `expo-sqlite` has no encryption option — `SQLiteOpenOptions` in 16.x offers
 * change listeners and libSQL, and nothing else. The file it wrote was plain
 * SQLite: journal free text, GPS coordinates, the whole financial ledger and
 * the private modules' rows, readable by anything that could get at the file.
 * `@op-engineering/op-sqlite` built with the SQLCipher flag is the swap that
 * closes it, with the key held in the device keystore (`getOrCreateDbKey`).
 *
 * ## Why opening is async now
 *
 * The key lives in SecureStore, which is async, and it is needed *before* the
 * first byte is read. `getDb()` therefore no longer opens on demand — it
 * throws until `initDatabase()` has run, and the root layout holds rendering
 * until it has. A lazily-opened encrypted database is a contradiction: the open
 * cannot happen inside a synchronous getter.
 *
 * ## Why the module is required, not imported
 *
 * `@op-engineering/op-sqlite`'s module body reads `NativeModules.OPSQLite` at
 * import time, so a static import crashes at startup on any binary that does
 * not contain the native module — which is every build made before this change.
 * Requiring it inside `initDatabase()` turns that into one legible error from
 * one place, rather than a white screen with a destructured-undefined stack.
 * Same reasoning as `lib/notifications.ts` and the ad slot.
 *
 * ## Why drizzle's *expo-sqlite* driver, against an op-sqlite database
 *
 * This looks wrong and is the single most important decision in the file.
 * `drizzle-orm/op-sqlite` builds on `SQLiteAsyncDialect`: every `.all()`,
 * `.get()` and `.run()` returns a Promise. `drizzle-orm/expo-sqlite` builds on
 * `SQLiteSyncDialect` and returns values. Every repository in this app — 24
 * files, and every hook and screen above them — is written against the
 * synchronous API. Adopting the op-sqlite driver would not be an engine swap;
 * it would be an async rewrite of the entire data layer.
 *
 * The sync driver asks its client for exactly one thing: `prepareSync(sql)`.
 * `opSqliteClient` below supplies it over op-sqlite's own synchronous
 * `executeSync`/`executeRawSync`, so drizzle stays synchronous, every
 * repository is untouched, and the only thing that actually changed is which
 * engine holds the file — the encrypted one.
 */

type OpSqliteModule = typeof import('@op-engineering/op-sqlite');
type OpDatabase = ReturnType<OpSqliteModule['open']>;
type Database = ReturnType<typeof drizzle<typeof schema>>;

/**
 * The raw surface the sync engine, media uploader, conflict store and data
 * import rely on — table-name-driven SQL that drizzle's typed API cannot
 * express. Deliberately the same four calls, with the same shapes, that
 * expo-sqlite provided, so none of those callers changed.
 */
export type RawDatabase = {
  execSync(sql: string): void;
  getAllSync<T>(sql: string, params?: unknown[]): T[];
  getFirstSync<T>(sql: string, params?: unknown[]): T | null;
  runSync(sql: string, params?: unknown[]): void;
};

let instance: Database | null = null;
let rawInstance: RawDatabase | null = null;
let opDb: OpDatabase | null = null;

/** op-sqlite runs exactly one statement per call; the bootstrap constants are
 *  many statements each. Splitting on `;` is safe for this SQL specifically —
 *  it declares no triggers and contains no semicolon inside a string literal,
 *  which database/schema.test.ts asserts rather than assumes. */
function execScript(db: OpDatabase, sql: string): void {
  for (const statement of sql.split(';')) {
    const trimmed = statement.trim();
    if (trimmed) db.executeSync(trimmed);
  }
}

/**
 * op-sqlite presented as the one method drizzle's synchronous driver calls.
 *
 * `prepareSync` does not prepare anything: op-sqlite's own prepared statements
 * only `execute()` asynchronously (`PreparedStatement` in its types has no
 * sync execute), so the statement returned here just closes over the SQL and
 * runs it on demand. op-sqlite compiles per call as a result — measurably
 * slower than a cached statement in a tight loop, and still faster than the
 * expo-sqlite engine this replaces.
 *
 * The accessors are lazy on purpose: drizzle's `run()` destructures `changes`,
 * while `all()`/`get()` go straight to the row accessors, and executing on
 * construction would run every query twice.
 */
export function opSqliteClient(db: OpDatabase) {
  return {
    prepareSync(sql: string) {
      return {
        executeSync(params: unknown[] = []) {
          let result: ReturnType<OpDatabase['executeSync']> | null = null;
          const runOnce = () => (result ??= db.executeSync(sql, params as never[]));
          return {
            get changes() {
              return runOnce().rowsAffected ?? 0;
            },
            get lastInsertRowId() {
              return runOnce().insertId ?? 0;
            },
            getAllSync: () => db.executeSync(sql, params as never[]).rows ?? [],
            getFirstSync: () => (db.executeSync(sql, params as never[]).rows ?? [])[0],
          };
        },
        /** Row values without column names, in select order — what drizzle maps
         *  onto its field list for typed results. */
        executeForRawResultSync(params: unknown[] = []) {
          return {
            getAllSync: () => db.executeRawSync(sql, params as never[]) ?? [],
          };
        },
        finalizeSync: () => undefined,
      };
    },
  };
}

function adapt(db: OpDatabase): RawDatabase {
  return {
    execSync: (sql) => execScript(db, sql),
    getAllSync: <T>(sql: string, params: unknown[] = []) =>
      (db.executeSync(sql, params as never[]).rows ?? []) as T[],
    getFirstSync: <T>(sql: string, params: unknown[] = []) =>
      ((db.executeSync(sql, params as never[]).rows ?? [])[0] ?? null) as T | null,
    runSync: (sql, params = []) => {
      db.executeSync(sql, params as never[]);
    },
  };
}

/**
 * Opens the encrypted database and brings it up to schema. Call once, at boot,
 * before anything calls `getDb()`. Idempotent.
 *
 * Throws rather than falling back to an unencrypted database. A silent fallback
 * would be the worst outcome available here: the app would work perfectly and
 * write everything in plaintext, and nothing downstream would ever notice.
 */
export async function initDatabase(): Promise<void> {
  if (instance) return;

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const opsqlite = require('@op-engineering/op-sqlite') as OpSqliteModule;

  /**
   * The build flag is compiled in, not configured at runtime: `package.json`'s
   * `"op-sqlite": { "sqlcipher": true }` only takes effect in a native build
   * made after it was added. Running this JS on an older binary gives a working
   * database that ignores `encryptionKey` entirely, so the check has to happen
   * here — the alternative is discovering it by pulling the file off a device.
   */
  if (!opsqlite.isSQLCipher()) {
    throw new Error(
      'This build was compiled without SQLCipher, so the database cannot be encrypted. ' +
        'Rebuild the native app after adding "op-sqlite": { "sqlcipher": true } to package.json.',
    );
  }

  const encryptionKey = await getOrCreateDbKey();
  const db = opsqlite.open({ name: 'lifeos.db', encryptionKey });

  // Write-ahead logging, for the same reason as before: sync writes a page of
  // pulled rows in one transaction while the UI reads the same tables, and
  // under the default rollback journal those readers block for the whole write.
  db.executeSync('PRAGMA journal_mode = WAL');

  const target: BootstrapTarget = adapt(db);
  bootstrapDatabase(target);

  opDb = db;
  rawInstance = target as RawDatabase;
  // `as never`: the sync driver's client type names expo-sqlite's SQLiteDatabase,
  // but it only ever calls prepareSync (see the header). The shim satisfies the
  // contract without being able to claim that whole nominal type.
  instance = drizzle(opSqliteClient(db) as never, { schema });

  // Only once the encrypted database is open AND at schema — a failure above
  // must leave the old file untouched, because it is still the only copy.
  discardLegacyPlaintextDatabase();
}

/**
 * Deletes the pre-encryption `lifeos.db` that expo-sqlite wrote.
 *
 * op-sqlite stores its file in a different directory, so the plaintext one is
 * not overwritten or migrated — it is simply orphaned. Leaving it there would
 * make the entire change cosmetic: the journal entries, coordinates and ledger
 * this is meant to protect would still be sitting on disk in the clear, just
 * beside an encrypted database nobody reads.
 *
 * The data is not carried across. SQLCipher cannot read a plaintext file, and
 * the copy path (`sqlcipher_export` over an ATTACH) is a great deal of
 * unverifiable machinery for a pre-release app with no users. Settings → Data →
 * Export produces a JSON backup for anyone who wants their rows first; that is
 * documented in docs/SQLCIPHER.md.
 *
 * Best-effort by design: never throws, because failing to remove the old file
 * is not a reason to refuse to start.
 */
function discardLegacyPlaintextDatabase(): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { File, Paths } = require('expo-file-system') as typeof import('expo-file-system');
    for (const name of ['lifeos.db', 'lifeos.db-wal', 'lifeos.db-shm']) {
      const file = new File(Paths.document, 'SQLite', name);
      if (file.exists) file.delete();
    }
  } catch {
    // An old install that never had the file, a platform without it, or an API
    // that moved — none of which should stop the app opening.
  }
}

export function getDb(): Database {
  if (!instance) {
    throw new Error('initDatabase() must complete before getDb() — see app/_layout.tsx.');
  }
  return instance;
}

/**
 * The raw handle, for code that needs table-name-driven SQL drizzle's typed API
 * cannot express — notably the generic sync engine. Prefer `getDb()` elsewhere.
 */
export function getRawDb(): RawDatabase {
  if (!rawInstance) {
    throw new Error('initDatabase() must complete before getRawDb() — see app/_layout.tsx.');
  }
  return rawInstance;
}

/** Closes the database. Test/teardown only; the app holds it open for its life. */
export function closeDatabase(): void {
  opDb?.close();
  opDb = null;
  instance = null;
  rawInstance = null;
}
