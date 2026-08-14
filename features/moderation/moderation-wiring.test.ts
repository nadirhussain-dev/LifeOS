import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

/**
 * That the safety features are actually reachable.
 *
 * This exists because of the specific way they were missing. `submitReport` and
 * its whole server side had been written, reviewed and migrated — 0013 —  and
 * no screen ever called it. Nothing failed: the typecheck passed, the tests
 * passed, the RPC was deployable. The app simply had a complete abuse pipeline
 * with no opening, and the only way to notice was to go looking for the caller.
 *
 * `SecureContentView` was the same shape: an `onReport` prop, no call site.
 *
 * Reporting and blocking are also the two things Google Play's user-generated
 * content policy and App Store 1.2 require of an app whose users can reach each
 * other, so "it exists but nothing calls it" is a review rejection as well as a
 * gap. A dead safety feature is worse than an absent one — it reads as done.
 *
 * Read as source text: these screens pull in expo-router, reanimated and the
 * bottom sheet, none of which render under Jest. The question is which module
 * calls which, and that is answerable statically.
 */

const ROOT = join(__dirname, '..', '..');

function sourceFiles(...directories: string[]): string[] {
  const out: string[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.tsx?$/.test(entry) && !entry.endsWith('.test.ts') && !entry.endsWith('.test.tsx'))
        out.push(path);
    }
  };
  for (const directory of directories) walk(join(ROOT, directory));
  return out;
}

/** Files whose source mentions `needle`, as repo-relative POSIX paths.
 *
 *  Forward slashes even on Windows: every assertion below is written with `/`
 *  (`stringContaining('private/albums')`, and the exact-match on the uploader),
 *  and `join(ROOT, path)` accepts either separator on the way back. Without the
 *  normalisation these read `features\private\...` and the suite fails only on
 *  a Windows machine — CI runs Ubuntu, so it stayed green while the local run
 *  did not. The `endsWith('services/reports.ts')` filters have the same
 *  dependency, and would silently stop excluding anything rather than fail. */
function filesMentioning(needle: string, ...directories: string[]): string[] {
  return sourceFiles(...directories)
    .filter((path) => readFileSync(path, 'utf8').includes(needle))
    .map((path) =>
      path
        .slice(ROOT.length + 1)
        .split(sep)
        .join('/'),
    );
}

describe('reporting is reachable', () => {
  it('has a screen that files a report', () => {
    // The assertion that would have failed for the year this was dead code.
    const callers = filesMentioning('submitReport', 'app', 'features', 'components').filter(
      (path) => !path.endsWith('services/reports.ts'),
    );
    expect(callers).not.toEqual([]);
  });

  it('offers it on the surfaces where users meet each other', () => {
    // Expense groups are the only place in LifeOS a stranger can reach you:
    // they add your email, invite you, and then write group and expense names
    // you can read. If reporting is anywhere, it has to be here.
    const screens = filesMentioning('ReportSheet', 'app');
    expect(screens).toEqual(expect.arrayContaining([expect.stringContaining('split')]));
  });

  it('sends only the item complained about', () => {
    // A report that carries the surrounding context is a way to exfiltrate a
    // whole shared space by complaining about one line of it.
    const sheet = readFileSync(
      join(ROOT, 'features/moderation/components/report-sheet.tsx'),
      'utf8',
    );
    expect(sheet).toContain('evidence: target.evidence');
    // Callers pass a built literal, never a whole query result.
    for (const path of filesMentioning('ReportSheet', 'app')) {
      const source = readFileSync(join(ROOT, path), 'utf8');
      expect(source).not.toMatch(/evidence:\s*(data|expenses|members)\b/);
    }
  });

  it('tells the user what leaves the device before it leaves', () => {
    const sheet = readFileSync(
      join(ROOT, 'features/moderation/components/report-sheet.tsx'),
      'utf8',
    );
    expect(sheet).toContain('sharing.reportEvidenceNote');
  });
});

describe('blocking is reachable', () => {
  it('has a screen that blocks somebody', () => {
    const callers = filesMentioning('useBlockMutations', 'app', 'features', 'components');
    expect(callers).not.toEqual([]);
  });

  it('can be reached without filing a report first', () => {
    // They are different decisions. Requiring a report to get to the block
    // means filing one you did not mean, which pollutes the queue the reports
    // exist to feed.
    const members = readFileSync(join(ROOT, 'app/split/[id]/members.tsx'), 'utf8');
    expect(members).toContain('moderation.blockTitle');
  });

  it('has a way back', () => {
    // A block you cannot review is a block you cannot undo.
    const screen = readFileSync(join(ROOT, 'app/settings/blocked.tsx'), 'utf8');
    expect(screen).toContain('unblock');
    expect(readFileSync(join(ROOT, 'app/settings/index.tsx'), 'utf8')).toContain(
      '/settings/blocked',
    );
    // Registered, or the route 404s and the Settings row is a dead end.
    expect(readFileSync(join(ROOT, 'app/_layout.tsx'), 'utf8')).toContain('settings/blocked');
  });

  it('never offers to list who blocked you', () => {
    // 0021 grants `blocker_id = auth.uid()` only, deliberately. Somebody who
    // can enumerate their blockers knows exactly who to reach from a second
    // account, and not being findable is usually the whole point.
    for (const path of filesMentioning('user_blocks', 'app', 'features')) {
      expect(readFileSync(join(ROOT, path), 'utf8')).not.toContain('blocked_id = ');
    }
    const service = readFileSync(join(ROOT, 'features/moderation/services/blocks.ts'), 'utf8');
    expect(service).not.toContain('list_blockers');
  });

  it('is enforced on the server, not by the screen that offers it', () => {
    // The person a block is aimed at is by definition motivated, and a check
    // in the client is one they can remove by building their own.
    const migration = readFileSync(join(ROOT, 'supabase/migrations/0021_user_blocks.sql'), 'utf8');
    for (const guard of [
      'guard_member_not_blocked', // being added to a group
      'guard_invitation_not_blocked', // being invited to one
      'accept_group_invitation', // a token minted before the block
    ]) {
      expect(migration).toContain(guard);
    }
  });
});

describe('shared albums: the same two gaps, closed the same way', () => {
  it('SecureContentView has a real caller', () => {
    // The file's own header comment named this exact shape of gap — a fully
    // built, fully tested component with an `onReport` prop and zero call
    // sites, same as `submitReport` was before 0021. Shared albums are its
    // first real use.
    const callers = filesMentioning('SecureContentView', 'app', 'features', 'components').filter(
      (path) => !path.endsWith('components/secure-content-view.tsx'),
    );
    expect(callers).not.toEqual([]);
    expect(callers).toEqual(expect.arrayContaining([expect.stringContaining('private/albums')]));
  });

  it('offers reporting on the album screen, not only on Split', () => {
    const screens = filesMentioning('ReportSheet', 'app');
    expect(screens).toEqual(expect.arrayContaining([expect.stringContaining('private/albums')]));
  });

  it('offers blocking on the album members screen', () => {
    const members = readFileSync(join(ROOT, 'app/private/albums/[id]/members.tsx'), 'utf8');
    expect(members).toContain('moderation.blockTitle');
  });

  it('is enforced on the server, not by the screen that offers it', () => {
    // Mirrors the expense-group assertion above — 0027 ports the same three
    // guard points to the album tables rather than leaving them expense-group
    // specific.
    const migration = readFileSync(
      join(ROOT, 'supabase/migrations/0027_shared_albums.sql'),
      'utf8',
    );
    for (const guard of [
      'guard_album_member_not_blocked',
      'guard_album_invitation_not_blocked',
      'accept_album_invitation',
    ]) {
      expect(migration).toContain(guard);
    }
  });

  it('encrypts photo bytes at exactly one choke point', () => {
    // Not "does this file call encryptBytes" — a second, unaudited upload
    // path would satisfy that just as well as the real one. The assertion is
    // that album-uploader.ts is the ONLY caller of the shared-albums upload,
    // so there is one place to audit for "did this actually encrypt first."
    const uploaders = filesMentioning('storage.from(SHARED_ALBUM_BUCKET).upload', 'features');
    expect(uploaders).toEqual(['features/private/services/album-uploader.ts']);
  });
});

describe('translations', () => {
  const LOCALES = ['ar', 'hi', 'ur'] as const;

  /** Flattened key paths, e.g. `moderation.blockTitle`. Memoised — the
   *  comparisons below are per-key, and re-reading a 100 KB catalogue inside a
   *  filter turned a millisecond assertion into four seconds. */
  const cache = new Map<string, Set<string>>();
  function keysOf(locale: string): Set<string> {
    const hit = cache.get(locale);
    if (hit) return hit;

    const data = JSON.parse(readFileSync(join(ROOT, `lib/i18n/locales/${locale}.json`), 'utf8'));
    const out = new Set<string>();
    const walk = (node: Record<string, unknown>, prefix: string) => {
      for (const [key, value] of Object.entries(node)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (value !== null && typeof value === 'object')
          walk(value as Record<string, unknown>, path);
        else out.add(path);
      }
    };
    walk(data, '');
    cache.set(locale, out);
    return out;
  }

  const english = keysOf('en');

  it('finds the catalogue (guards against comparing two empty sets)', () => {
    expect(english.size).toBeGreaterThan(1000);
  });

  it.each(LOCALES)('%s translates every English string', (locale) => {
    // A missing key renders as the key itself — `moderation.blockTitle` in the
    // middle of a confirmation dialog. i18next falls back silently, so nothing
    // reports it except somebody reading that screen in that language.
    const missing = [...english].filter((key) => !keysOf(locale).has(key));
    expect(missing).toEqual([]);
  });

  it.each(LOCALES)('%s adds only plural forms English does not need', (locale) => {
    // Arabic has six plural categories to English's two, so extra `_zero`,
    // `_two`, `_few` and `_many` keys are correct rather than drift. Anything
    // else extra is a key that no longer has an English original — usually a
    // rename that only landed on one side.
    const orphans = [...keysOf(locale)].filter(
      (key) => !english.has(key) && !/_(zero|one|two|few|many|other)$/.test(key),
    );
    expect(orphans).toEqual([]);
  });
});
