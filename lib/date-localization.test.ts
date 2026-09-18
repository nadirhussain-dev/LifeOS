import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * No user-facing date may be built from a hardcoded date-fns pattern.
 *
 * A completeness scan, for the same reason `app/screen-error-states.test.ts`
 * is one: the property is about the set of all call sites. The bug it locks
 * out was invisible in every behavioural test the app had, because every one
 * of them ran in English — `format(d, 'MMM d, yyyy')` is perfectly correct
 * until somebody switches the app to Arabic, and then it is still "Mar 14,
 * 2026" sitting inside Arabic UI, on all 87 files at once.
 *
 * `lib/date-format.ts` is the replacement: semantic styles resolved through
 * `Intl.DateTimeFormat` in the language the app is set to.
 */

const ROOTS = ['app', 'features', 'components', 'hooks', 'lib'];

/**
 * Patterns that are storage, not text.
 *
 * `logDate` columns, query keys, row ids. Localizing one would change what a
 * row is *called* — an Arabic user's journal entry would be filed under a
 * different key than the same day written by the same person in English, and
 * the two would never join up again. These must stay on `date-fns/format`,
 * and their staying there is the signal that they are not for reading.
 */
const MACHINE_KEYS = new Set(['yyyy-MM-dd', 'yyyy-MM']);

const CALL = /\bformat\(\s*[^,]+?,\s*'([^']+)'\s*\)/g;

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sources(path, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(path);
  }
  return out;
}

describe('dates on screen are localized', () => {
  const offenders: { path: string; pattern: string }[] = [];
  for (const root of ROOTS) {
    for (const path of sources(root)) {
      const source = readFileSync(path, 'utf8');
      for (const match of source.matchAll(CALL)) {
        const pattern = match[1];
        if (!MACHINE_KEYS.has(pattern)) offenders.push({ path, pattern });
      }
    }
  }

  it('builds no user-facing date from a hardcoded pattern', () => {
    expect(offenders).toEqual([]);
  });

  it('still uses raw patterns for the keys that must not move', () => {
    // Guards the exemption from the other direction. If these ever became
    // localized the app would file the same day under two different ids
    // depending on the reader's language, and nothing would join them again.
    const machine = ROOTS.flatMap((root) => sources(root))
      .map((path) => readFileSync(path, 'utf8'))
      .flatMap((source) => [...source.matchAll(CALL)].map((m) => m[1]))
      .filter((pattern) => MACHINE_KEYS.has(pattern));

    expect(machine.length).toBeGreaterThan(0);
  });
});
