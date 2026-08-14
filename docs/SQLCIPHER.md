# SQLCipher — at-rest database encryption

**Status: implemented in code, never run.** `database/client.ts` opens the
database through `@op-engineering/op-sqlite` with the key from
`features/security/lib/db-key.ts`, and `app/_layout.tsx` holds rendering until
it is open. Everything below the "Verify on device" heading is still
outstanding — **no build containing this has ever been made or launched**, and
a mistake here means the app cannot open its database at all.

## The one non-obvious decision

Do **not** use `drizzle-orm/op-sqlite`. It is built on `SQLiteAsyncDialect`, so
every `.all()`, `.get()` and `.run()` returns a Promise — adopting it is not an
engine swap, it is an async rewrite of all 24 repositories and every hook and
screen above them. This was discovered by trying it: `tsc` produced hundreds of
`Property 'map' does not exist on type 'Promise<...>'`.

The database is therefore driven through `drizzle-orm/expo-sqlite`, whose
`SQLiteSyncDialect` keeps everything synchronous. That driver asks its client
for exactly one method — `prepareSync(sql)` — and `opSqliteClient()` in
`database/client.ts` supplies it over op-sqlite's own synchronous
`executeSync`/`executeRawSync`. No repository changed.

`database/op-sqlite-client.test.ts` exercises that shim against a real SQLite
(`node:sqlite` standing in for the native engine), because nothing about it
fails at compile time: the client is passed `as never`, so a wrong field name
shows up as empty lists on a device rather than an error here.

## What has been done

### 1. Install + enable SQLCipher — DONE

```bash
npx expo install @op-engineering/op-sqlite
```

`package.json` carries the build flag:

```json
"op-sqlite": { "sqlcipher": true }
```

**The flag is compiled in, so it only takes effect in a native build made after
it was added.** `initDatabase()` calls `isSQLCipher()` and throws if the running
binary lacks it — a silent fallback would give a perfectly working app writing
plaintext, which is the worst outcome available here.

### 2. Open before any DB access — DONE

The key is async (SecureStore) and is needed before the first byte is read, so
`getDb()` no longer opens on demand: it throws until `initDatabase()` has run.
`app/_layout.tsx` holds rendering on `dbReady`, and the effect that rebuilds
reminders waits on it too — everything it calls reads the database.

A failure renders `DatabaseUnavailable` rather than a blank screen. It uses raw
`View`/`Text` with inline styles on purpose: it renders before fonts load, and
outside the `ErrorBoundary` (which lives further down the same tree and so
cannot catch a throw from `RootLayout` itself).

### 3. `database/client.ts` — DONE

See the file. Two things differ from what this document originally prescribed:

- **The drizzle driver is `expo-sqlite`, not `op-sqlite`** — see "The one
  non-obvious decision" above. This is the important one.
- **`bootstrapDatabase()` is reused as-is** rather than reimplemented. Its
  `BootstrapTarget` was already an abstract two-method interface, so the
  op-sqlite adapter satisfies it directly and `applyAdditiveColumns` did not
  change at all.

### 4. Existing plaintext data — DONE (it is deleted)

op-sqlite stores its file in a different directory from expo-sqlite, so the old
plaintext `lifeos.db` is not migrated or overwritten — it is orphaned.
`discardLegacyPlaintextDatabase()` deletes it (plus `-wal`/`-shm`) once the
encrypted database is open **and** at schema, so a failure leaves the only copy
of the data intact.

Leaving it would have made the whole change cosmetic: the journal text,
coordinates and ledger this protects would still be on disk in the clear.

**Data does not carry across.** SQLCipher cannot read a plaintext file, and
`sqlcipher_export` over an ATTACH is a lot of unverifiable machinery for a
pre-release app with no users. Use Settings → Data → **Export data** first if
you want your rows; re-import is manual today.

### 5. Verify on device

**This is the outstanding work.** Everything above is written but has never run.
The native module is not in any existing build, so the app will not start until
a new one is made:

```bash
eas build -p android --profile development
```

Then, in order — each step fails differently, so do not skip ahead:

1. **App launches at all.** If it shows "LifeOS can't open its database" saying
   the build lacks SQLCipher, the `package.json` flag did not reach the build.
   Any other message is `initDatabase()` failing for a different reason and the
   text is the error.
2. **The schema exists.** Open Tasks, Habits, Budget. Empty lists are expected
   (the old data is gone by design); a crash or an error state is the
   statement-splitting or the `prepareSync` shim being wrong.
3. **Writes land.** Create a task, force-quit, relaunch → it is still there.
   This is what proves `rowsAffected` maps onto drizzle's `changes` correctly;
   `database/op-sqlite-client.test.ts` covers it against `node:sqlite`, not
   against the real native engine.
4. **Sync still works.** Sign in and run a sync. The sync engine is the heaviest
   user of the raw adapter (`getAllSync`/`getFirstSync`/`runSync`) and the only
   place that builds SQL by table name.
5. **It is actually encrypted.** Pull the file off the device and confirm it is
   not readable as plain SQLite:

   ```bash
   adb shell "run-as com.lifeos.app cat databases/lifeos.db" > lifeos.db
   sqlite3 lifeos.db ".tables"   # must fail: "file is not a database"
   ```

   A file that opens fine is the failure this whole change exists to prevent —
   `isSQLCipher()` should have thrown first, so treat it as a real bug.

6. **The plaintext file is gone.** Confirm the old expo-sqlite copy no longer
   exists, since it holds the same data unencrypted:

   ```bash
   adb shell "run-as com.lifeos.app ls files/SQLite/"   # no lifeos.db
   ```
