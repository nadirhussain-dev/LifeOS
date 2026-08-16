import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The storage keys, pinned verbatim. From here on they never change again.
 *
 * These are not brand surfaces — no user ever sees one — and changing any of
 * them destroys data that cannot be recovered:
 *
 *   - `daykeep.db.key` is the SQLCipher key in the OS keystore. Rename it and
 *     the existing encrypted database can never be opened again. Not "resets"
 *     — *never*, because that key is the only thing that could have decrypted
 *     it.
 *   - `daykeep.vault.wrapped` / `.alt` / `.salt` wrap the private space's keys.
 *     Same outcome, on the most sensitive data in the app.
 *   - `daykeep.db` is the database filename; a new name is a new, empty
 *     database sitting next to the user's real one.
 *   - `daykeep.device-id` and `daykeep.install.id` are identity. Losing them
 *     makes 0048 treat a known phone as a stranger and demand a fresh OTP.
 *   - The widget keys hold the snapshot and the queue of taps made while the
 *     app was closed.
 *
 * ## Why they say `daykeep` and not `lifeos`
 *
 * They were renamed exactly once, during the rebrand, and only because the app
 * had not launched: no user held a database, and staging was reset from 0001 in
 * the same change. That was a deliberate one-off with a known blast radius —
 * the developer's own test data — and it is not repeatable. Any future rename
 * is a data migration that has to read the old key first, not a find-and-replace.
 *
 * **If this test fails, do not update the expected value.** Put the key back.
 */

const ROOT = join(__dirname, '..');

/** Key → the file that owns it, so a failure says where to look. */
const PINNED: Record<string, string> = {
  'daykeep.db': 'database/client.ts',
  'daykeep.db-wal': 'database/client.ts',
  'daykeep.db-shm': 'database/client.ts',
  'daykeep.db.key': 'features/security/lib/db-key.ts',
  'daykeep.vault.salt': 'features/private/services/vault-keys.ts',
  'daykeep.vault.wrapped': 'features/private/services/vault-keys.ts',
  'daykeep.vault.wrapped.alt': 'features/private/services/vault-keys.ts',
  'daykeep.vault.attempts': 'features/private/services/vault-keys.ts',
  'daykeep.device-id': 'lib/device-id.ts',
  'daykeep.install.id': 'features/analytics/services/install-id.ts',
  'daykeep.widget.today.v1': 'features/widgets/services/widget-snapshot.ts',
  'daykeep.widget.actions.v1': 'features/widgets/services/widget-actions.ts',
};

/** The album-key namespace is templated per album, so it is checked as a prefix. */
const PINNED_PREFIX: Record<string, string> = {
  'daykeep.album.': 'features/private/services/album-keys.ts',
};

const SOURCE_DIRS = ['app', 'features', 'lib', 'database', 'components', 'hooks'];

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory)) {
      if (entry === 'node_modules' || entry === '.git' || entry === 'dist') continue;
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      if (/\.tsx?$/.test(entry) && !entry.endsWith('.test.ts')) out.push(path);
    }
  };
  for (const directory of SOURCE_DIRS) walk(join(ROOT, directory));
  return out;
}

describe('storage keys are frozen', () => {
  it.each(Object.entries(PINNED))('%s is still declared in %s', (key, file) => {
    expect(readFileSync(join(ROOT, file), 'utf8')).toContain(`'${key}'`);
  });

  it.each(Object.entries(PINNED_PREFIX))('the %s namespace survives in %s', (prefix, file) => {
    expect(readFileSync(join(ROOT, file), 'utf8')).toContain(prefix);
  });

  /**
   * The inverse: nothing may still reach for the pre-rebrand spelling. A stray
   * `lifeos.` key left behind would read from a namespace nothing else writes,
   * which fails as an empty value rather than as an error — the quietest bug
   * shape there is.
   */
  it('no source file still reaches for a lifeos-prefixed key', () => {
    const offenders = sourceFiles()
      .filter((path) => /['"`]lifeos\.[a-z]/i.test(readFileSync(path, 'utf8')))
      .map((path) => path.slice(ROOT.length + 1));

    expect(offenders).toEqual([]);
  });
});
