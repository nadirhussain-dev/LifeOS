import { notifyWrite, parseWrite, setWriteObserver, type WriteVerb } from './write-observer';

/**
 * The parser is tested directly because its failure mode is silence.
 *
 * If it stopped matching drizzle's SQL, nothing would throw and no test of any
 * behaviour further up would fail — the challenge would simply record that
 * nobody had used anything, and the first sign would be users losing days they
 * had earned.
 */
describe('parseWrite', () => {
  const cases: [string, string, WriteVerb][] = [
    ['insert into "habit_logs" ("id") values (?)', 'habit_logs', 'insert'],
    ['insert into habit_logs (id) values (?)', 'habit_logs', 'insert'],
    ['INSERT INTO "Tasks" DEFAULT VALUES', 'tasks', 'insert'],
    ['insert or replace into "water_intake_logs" ("id") values (?)', 'water_intake_logs', 'insert'],
    ['insert or ignore into "notes" ("id") values (?)', 'notes', 'insert'],
    ['update "habits" set "name" = ? where "id" = ?', 'habits', 'update'],
    ['  update goals set title = ?', 'goals', 'update'],
    ['delete from "journal_entries" where "id" = ?', 'journal_entries', 'delete'],
    ['DELETE FROM notes WHERE id = ?', 'notes', 'delete'],
  ];

  it.each(cases)('reads %s', (sql, table, verb) => {
    expect(parseWrite(sql)).toEqual({ table, verb });
  });

  it('ignores reads, which are the overwhelming majority of statements', () => {
    expect(parseWrite('select * from "habits"')).toBeNull();
    expect(parseWrite('  SELECT count(*) FROM tasks')).toBeNull();
  });

  it('ignores schema and pragma statements', () => {
    expect(parseWrite('create table "habits" (id text)')).toBeNull();
    expect(parseWrite('PRAGMA table_info(habits)')).toBeNull();
    expect(parseWrite('begin')).toBeNull();
  });
});

describe('notifyWrite', () => {
  afterEach(() => setWriteObserver(null));

  it('does nothing at all when nobody is observing', () => {
    expect(() => notifyWrite('insert into "habits" ("id") values (?)')).not.toThrow();
  });

  it('reports the table and verb to the observer', () => {
    const seen: [string, WriteVerb][] = [];
    setWriteObserver((table, verb) => seen.push([table, verb]));

    notifyWrite('insert into "habit_logs" ("id") values (?)');
    notifyWrite('select * from "habits"');
    notifyWrite('delete from "habit_logs" where "id" = ?');

    expect(seen).toEqual([
      ['habit_logs', 'insert'],
      ['habit_logs', 'delete'],
    ]);
  });

  it('never lets a broken observer take down a database write', () => {
    setWriteObserver(() => {
      throw new Error('observer exploded');
    });
    expect(() => notifyWrite('insert into "habits" ("id") values (?)')).not.toThrow();
  });
});
