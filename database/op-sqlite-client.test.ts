import { DatabaseSync } from 'node:sqlite';
import { drizzle } from 'drizzle-orm/expo-sqlite';
import { eq } from 'drizzle-orm';

import { bootstrapDatabase, type BootstrapTarget } from '@/database/bootstrap';
import { opSqliteClient } from '@/database/client';
import * as schema from '@/database/schema';

/**
 * The shim that lets drizzle's SYNCHRONOUS driver run on op-sqlite.
 *
 * This is the load-bearing piece of the SQLCipher swap and the one that cannot
 * be checked by reading it. `drizzle-orm/op-sqlite` is built on
 * `SQLiteAsyncDialect` — adopting it would turn every repository in the app
 * async — so the encrypted engine is driven through `drizzle-orm/expo-sqlite`
 * instead, whose entire client contract is `prepareSync(sql)`.
 *
 * If any part of that contract is wrong, nothing fails at compile time: the
 * types are satisfied by `as never` at the call site, and the failure appears
 * as a screen full of empty lists, or a write that silently does nothing, on a
 * device. So the contract is exercised here against a real SQLite instead —
 * `node:sqlite`, the same engine, standing in for op-sqlite's native one.
 */

/** node:sqlite wearing op-sqlite's `executeSync`/`executeRawSync` surface. */
function fakeOpSqlite(db: DatabaseSync) {
  return {
    executeSync: (sql: string, params: unknown[] = []) => {
      const stmt = db.prepare(sql);
      /**
       * Split on the verb, not on whether `.all()` throws.
       *
       * node:sqlite happily runs an UPDATE through `.all()` and hands back an
       * empty array, so a try/catch here reports `rowsAffected: 0` for every
       * write that actually succeeded — and this fake would then be lying about
       * the one thing op-sqlite is being trusted to report. op-sqlite returns
       * rows for reads and rowsAffected for writes; so does this.
       */
      if (/^\s*(select|pragma|with)\b/i.test(sql)) {
        return {
          rows: stmt.all(...(params as [])) as Record<string, unknown>[],
          rowsAffected: 0,
          insertId: 0,
        };
      }
      const result = stmt.run(...(params as []));
      return {
        rows: [],
        rowsAffected: Number(result.changes),
        insertId: Number(result.lastInsertRowid),
      };
    },
    /**
     * op-sqlite does NOT return the rows themselves here. `executeRawSync`
     * hands back a `RawQueryResult` — `{ rowsAffected, insertId, rawRows,
     * columnNames }`, built in cpp/utils.cpp — and the row arrays live under
     * `rawRows`. An earlier version of this fake returned the bare array, which
     * is what a reasonable reading of the name suggests and is not what the
     * engine does; every typed select in the app then died on `rows.map is not
     * a function` while this suite stayed green. The fake mirrors the real
     * shape now, because that is the only thing it is here to do.
     */
    executeRawSync: (sql: string, params: unknown[] = []) => {
      const rows = db.prepare(sql).all(...(params as [])) as Record<string, unknown>[];
      return {
        rowsAffected: 0,
        insertId: 0,
        rawRows: rows.map((row) => Object.values(row)),
        columnNames: rows.length ? Object.keys(rows[0]) : [],
      };
    },
    close: () => db.close(),
  };
}

function open() {
  const raw = new DatabaseSync(':memory:');
  const fake = fakeOpSqlite(raw);
  const target: BootstrapTarget = {
    execSync: (sql: string) => {
      for (const statement of sql.split(';')) {
        if (statement.trim()) fake.executeSync(statement.trim());
      }
    },
    getAllSync: <T>(sql: string) => fake.executeSync(sql).rows as T[],
  };
  bootstrapDatabase(target);
  return { fake, db: drizzle(opSqliteClient(fake as never) as never, { schema }) };
}

describe('opSqliteClient', () => {
  it('bootstraps the real schema through the shim', () => {
    // Statement splitting is part of the swap too: op-sqlite runs one statement
    // per call, while TABLE_BOOTSTRAP_SQL is dozens.
    const { fake } = open();
    const tables = fake.executeSync("SELECT name FROM sqlite_master WHERE type = 'table'").rows;
    expect(tables.length).toBeGreaterThan(30);
  });

  it('reads rows back with their column names', () => {
    // The failure this catches: raw row order or naming being wrong makes every
    // list in the app render empty, with no error anywhere.
    const { db } = open();
    db.insert(schema.tasks)
      .values({
        id: 't1',
        userId: 'local',
        title: 'Encrypted task',
        status: 'todo',
        priority: 'none',
        createdAt: 1,
        updatedAt: 1,
      })
      .run();

    const rows = db.select().from(schema.tasks).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe('Encrypted task');
    expect(rows[0].status).toBe('todo');
  });

  it('returns a single row from .get()', () => {
    const { db } = open();
    db.insert(schema.tasks)
      .values({
        id: 't1',
        userId: 'local',
        title: 'One',
        status: 'todo',
        priority: 'none',
        createdAt: 1,
        updatedAt: 1,
      })
      .run();

    const row = db.select().from(schema.tasks).where(eq(schema.tasks.id, 't1')).get();
    expect(row?.title).toBe('One');
  });

  it('reports rows affected, which is how the app knows a write landed', () => {
    // `changes` maps to op-sqlite's `rowsAffected`, not a field called changes —
    // getting that wrong makes reconcilePassedNotifications always report 0.
    const { db } = open();
    db.insert(schema.tasks)
      .values({
        id: 't1',
        userId: 'local',
        title: 'Before',
        status: 'todo',
        priority: 'none',
        createdAt: 1,
        updatedAt: 1,
      })
      .run();

    const result = db
      .update(schema.tasks)
      .set({ title: 'After' })
      .where(eq(schema.tasks.id, 't1'))
      .run();

    expect(result.changes).toBe(1);
    expect(db.select().from(schema.tasks).get()?.title).toBe('After');
  });

  it('deletes', () => {
    const { db } = open();
    db.insert(schema.tasks)
      .values({
        id: 't1',
        userId: 'local',
        title: 'Doomed',
        status: 'todo',
        priority: 'none',
        createdAt: 1,
        updatedAt: 1,
      })
      .run();

    db.delete(schema.tasks).where(eq(schema.tasks.id, 't1')).run();
    expect(db.select().from(schema.tasks).all()).toEqual([]);
  });

  it('does not execute a query twice', () => {
    // The accessors are lazy so `run()` can read `changes` without re-running.
    // A double execution would double every insert.
    const { db } = open();
    db.insert(schema.tasks)
      .values({
        id: 't1',
        userId: 'local',
        title: 'Once',
        status: 'todo',
        priority: 'none',
        createdAt: 1,
        updatedAt: 1,
      })
      .run();

    expect(db.select().from(schema.tasks).all()).toHaveLength(1);
  });
});
