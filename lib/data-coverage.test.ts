import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Guards the two operations that must cover the WHOLE schema: exporting your
 * data, and deleting it.
 *
 * Both used to be hand-maintained lists, and both had silently fallen behind.
 * `clearAllData` missed 15 of 38 tables — the entire budget ledger, goals,
 * sleep, study and gallery — so "delete all my data" left the most sensitive
 * things on the device. A list that has to be remembered will eventually not
 * be, which is why the wipe now reads `sqlite_master` instead; this test holds
 * the line for the export, which still names its tables explicitly (it has to —
 * each one is exported under its own key).
 *
 * Read as source text rather than imported: both modules pull in expo-sqlite
 * and expo-file-system, which need a native runtime that Jest does not have.
 * The question here is which tables are named, and that is answerable statically.
 */

const ROOT = join(__dirname, '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

/** Source with comments removed — these assertions are about what the code
 *  does, and the files explain the old behaviour in prose. */
const readCode = (path: string) =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

/** Every `sqliteTable('name', …)` declared in the schema. */
function schemaTables(): { variable: string; table: string }[] {
  const source = read('database/schema.ts');
  return [...source.matchAll(/export const (\w+) = sqliteTable\(\s*'(\w+)'/g)].map((m) => ({
    variable: m[1],
    table: m[2],
  }));
}

/**
 * Tables that are deliberately not in the user's export.
 *
 * `notification_log` is delivery bookkeeping the app writes about itself — no
 * part of it is user-authored content.
 *
 * `private_entries` is the opposite case: it is the most sensitive content in
 * the app, and that is exactly why it is out of the *plaintext* export. The export writes a plaintext
 * JSON file to the share sheet, so including these rows would mean either
 * shipping ciphertext nobody can ever read back, or decrypting the private
 * space into a file that lands in Files, Drive, or a chat — undoing the whole
 * feature in one tap. The private space is deliberately not backed up; the
 * setup screen says so before a PIN is chosen.
 *
 * `sync_conflicts` holds copies of rows the user already has — it is this
 * device's note of which edits a newer version overwrote, and every snapshot in
 * it is a duplicate of content exported from its own table. Including it would
 * put stale copies of notes and tasks in the backup alongside the real ones,
 * which is worse than useless in a file somebody may restore from.
 */
const EXPORT_EXEMPT = new Set(['notification_log', 'private_entries', 'sync_conflicts']);

describe('schema coverage', () => {
  it('finds the schema (guards against the regex silently matching nothing)', () => {
    expect(schemaTables().length).toBeGreaterThan(30);
  });

  it('exports every table holding user data', () => {
    const source = readCode('lib/data-export.ts');
    const missing = schemaTables()
      .filter((t) => !EXPORT_EXEMPT.has(t.table))
      .filter((t) => !new RegExp(`\\b${t.variable}\\b`).test(source))
      .map((t) => t.table);

    // Named in the failure so the message says which module was left out.
    expect(missing).toEqual([]);
  });

  it('wipes by discovery rather than by a list that can fall behind', () => {
    const source = readCode('lib/data-management.ts');
    expect(source).toMatch(/sqlite_master/);
    // The old shape. If someone reintroduces a hand-written list, the 15-table
    // gap comes back with it.
    expect(source).not.toMatch(/db\.delete\(/);
  });

  it('frees the on-disk media a wipe would otherwise orphan', () => {
    const source = readCode('lib/data-management.ts');
    for (const directory of ['songs', 'gallery', 'attachments', 'private-vault']) {
      expect(source).toContain(`'${directory}'`);
    }
  });

  it('destroys the vault keys, which no table or directory wipe would reach', () => {
    // They live in the OS keystore. Without this, "delete all my data" leaves
    // behind the keys to the data it just deleted.
    expect(readCode('lib/data-management.ts')).toContain('destroyVaultKeys');
  });

  it('keeps the seeded journal prompts, which are app content not user data', () => {
    expect(readCode('lib/data-management.ts')).toMatch(/journal_prompts:\s*'user_id IS NULL'/);
  });
});

/**
 * The private space's containment.
 *
 * Every one of these currently holds because the surface in question uses an
 * explicit allow-list, so a new table is invisible until somebody adds it. That
 * is a fine mechanism and a terrible thing to rely on silently: the failure
 * mode is a well-meaning "wire up the new table everywhere" commit that leaks
 * a period tracker into global search. These assertions make that commit fail.
 */
describe('private space containment', () => {
  const PRIVATE_TABLE = 'private_entries';
  const PRIVATE_VARIABLE = 'privateEntries';

  it('is never read by global search', () => {
    // Search results render titles and snippets. A vault filename appearing
    // under a stray query is the single most damaging possible leak.
    //
    // Search *does* import the private store — to filter privatised modules'
    // results out — so the invariant is narrower than "never mentions private":
    // it must never reach the repository that decrypts rows.
    const source = readCode('features/search/services/search-sources.ts');
    expect(source).not.toContain(PRIVATE_VARIABLE);
    expect(source).not.toContain('private-repository');
    expect(source).not.toContain('vault');
  });

  it('filters privatised modules out of search results', () => {
    const source = readCode('features/search/services/search-sources.ts');
    expect(source).toContain('hiddenSearchKinds');
    // Derived from the Hub registry, not a second hand-kept list that can and
    // will disagree with the first.
    expect(source).toContain('HUB_SECTIONS');
  });

  it('is never written to the plaintext export', () => {
    const source = readCode('lib/data-export.ts');
    expect(source).not.toContain(PRIVATE_VARIABLE);
    expect(source).not.toContain(PRIVATE_TABLE);
  });

  it('leaves privatised modules out of the export, and says which', () => {
    // Silently exporting less than the user expects is how somebody wipes a
    // device believing they have a full backup.
    const source = readCode('lib/data-export.ts');
    expect(source).toContain('privatisedTables');
    expect(source).toContain('omittedPrivateModules');
  });

  it('is never restored from an import', () => {
    // An import that could write private_entries would be a way to plant rows
    // encrypted under somebody else's key.
    const source = readCode('lib/data-import.ts');
    expect(source).not.toContain(PRIVATE_VARIABLE);
    expect(source).not.toContain(PRIVATE_TABLE);
  });

  it('only ever syncs as an opt-in sensitive module', () => {
    // This assertion used to be "never syncs at all". Migration 0015 changed
    // that by design: private entries can now sync so they reach a second
    // device. The invariant that survives — and the one that matters — is that
    // it can only happen because the user turned it on. `sensitive: true` is
    // what makes the module default to OFF (defaultModuleFlags), so a build
    // that flipped it to false would silently start uploading everybody's
    // private space on next launch.
    const source = readCode('features/sync/config/sync-tables.ts');
    const entry = source.slice(source.indexOf(`'${PRIVATE_TABLE}'`));
    expect(entry).toMatch(/sensitive:\s*true/);
  });

  it('keeps sensitive modules off by default', () => {
    const source = readCode('features/sync/config/sync-tables.ts');
    // `acc[m.key] = !m.sensitive` — the one line the assertion above leans on.
    expect(source).toMatch(/!m\.sensitive/);
  });

  it('never names its content in a notification', () => {
    // Notifications render on a lock screen, to whoever is holding the phone.
    const source = readCode('features/notifications/services/reminder-scheduler.ts');
    expect(source).not.toContain('features/private');
  });

  it('is still erased by "delete all data"', () => {
    // The one place it must NOT be exempt. The wipe reads sqlite_master, so
    // this holds by construction — assert the construction, since an exemption
    // list creeping back in is what would break it.
    const source = readCode('lib/data-management.ts');
    expect(source).toMatch(/sqlite_master/);
    expect(source).not.toContain(PRIVATE_TABLE);
  });

  it('gates every module sub-route, not just its entry screen', () => {
    // A per-screen guard is a thing to remember, and the screen it is forgotten
    // on is the deep link somebody actually follows. The guard matches on the
    // first path segment so /budget/transactions/x is covered by the same rule
    // as /budget.
    const guard = readCode('features/module-flags/hooks/use-module-access.ts');
    expect(guard).toContain('moduleForPath');
    expect(guard).toContain('/private/unlock');
  });

  it('does not act on the privatised list before it has rehydrated', () => {
    // Otherwise a privatised module renders for a frame on every cold start —
    // the exact moment somebody else might be holding the phone.
    const guard = readCode('features/module-flags/hooks/use-module-access.ts');
    expect(guard).toMatch(/if \(!hydrated\) return;/);
  });

  it('keeps the vault key out of anything persisted to AsyncStorage', () => {
    // `partialize` is the only thing standing between the master key and a
    // plaintext file on disk. Matched narrowly — to the end of that property,
    // not the end of the file — so the store's own helpers reading `key` do
    // not make this pass or fail for the wrong reason.
    const source = readCode('features/private/store/private-store.ts');
    const partialize = /partialize:[\s\S]*?\}\),/.exec(source)?.[0];

    expect(partialize).toBeDefined();
    expect(partialize).toContain('enabledModules');
    expect(partialize).not.toMatch(/\bkey\b/);
    expect(partialize).not.toMatch(/\bspace\b/);
    expect(partialize).not.toMatch(/backgroundedAt/);
  });
});
