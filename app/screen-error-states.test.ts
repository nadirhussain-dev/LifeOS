import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every screen that renders query data must say so when the read fails.
 *
 * A completeness scan, and one of the cases where reading source as text is
 * the honest tool: the property is about the *set* of all screens, not the
 * behaviour of any one of them. No behavioural test can assert "and there is
 * no fourteenth screen that forgot" — that is exactly the screen this catches.
 *
 * The failure it prevents is specific. A screen written as
 * `const { data = [] } = useThing()` renders its empty state when the read
 * fails, so "your notes failed to load" and "you have no notes" become the
 * same screen. These reads are mostly local SQLite, which fails when the
 * database itself will not open — the moment where telling somebody their
 * data is simply absent is worst, and where there is no retry offered because
 * the screen does not know anything went wrong.
 *
 * `components/ui/query-error.tsx` is the shared answer: cause-derived copy, a
 * retry only where retrying can help.
 *
 * ## The allowlist
 *
 * `KNOWN_GAPS` is the backlog, not an exemption list. It may only ever shrink
 * — a screen added to it is a screen shipping the bug on purpose. The test
 * fails if an entry is stale, so a fixed screen cannot be left behind in it
 * and quietly re-break later.
 */

const SCREENS = 'app';

/**
 * Whether the screen reads anything from a query at all.
 *
 * Any `{ data ... } = useSomething()` destructure counts, plus a bare
 * `isLoading`. The first version keyed on `data: x =` and `data = []`, which
 * missed `const { data: existing } = useTransaction(id)` — and those edit
 * forms turned out to hold the worst instance of the bug, not the mildest.
 */
function readsQueryData(source: string): boolean {
  return /\{\s*data\s*[,:}]/.test(source) || /\bisLoading\b/.test(source);
}

function handlesFailure(source: string): boolean {
  // `<QueryError`, not `QueryError` — a bare mention matches the import line,
  // which survives deleting the element that used it. The first version of
  // this test did exactly that and went on passing when a screen's error
  // branch was removed underneath it.
  return /\bisError\b|<QueryError/.test(source);
}

function screenFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      screenFiles(path, out);
    } else if (entry.endsWith('.tsx')) {
      out.push(path);
    }
  }
  return out;
}

/**
 * Screens that read query data and do not yet report a failure.
 *
 * Grouped by module so the remaining work reads as work rather than as a flat
 * list of paths.
 */
const KNOWN_GAPS: readonly string[] = [
  // (auth)
  'app/(auth)/reset-password.tsx',
  // budget
  'app/budget/currency.tsx',
  'app/budget/recurring/new.tsx',
  'app/budget/savings/[id].tsx',
  'app/budget/savings/new.tsx',
  'app/budget/settings.tsx',
  // goals
  'app/goals/[id].tsx',
  'app/goals/[id]/edit.tsx',
  'app/goals/[id]/log.tsx',
  // habit
  'app/habit/[id].tsx',
  'app/habit/[id]/edit.tsx',
  // journal
  'app/journal/[date].tsx',
  // music
  'app/music/now-playing.tsx',
  'app/music/playlist/[id].tsx',
  'app/music/playlist/[id]/add-songs.tsx',
  'app/music/song/[id].tsx',
  // private
  'app/private/albums/[id].tsx',
  'app/private/albums/[id]/chat.tsx',
  'app/private/albums/[id]/invite.tsx',
  'app/private/albums/[id]/notes.tsx',
  'app/private/albums/[id]/plans.tsx',
  'app/private/albums/index.tsx',
  'app/private/albums/invites.tsx',
  'app/private/together.tsx',
  // routine
  'app/routine/[id].tsx',
  // settings
  'app/settings/media.tsx',
  'app/settings/operator/pricing.tsx',
  'app/settings/sync-conflicts.tsx',
  // sleep
  'app/sleep/settings.tsx',
  // study
  'app/study/log.tsx',
  'app/study/settings.tsx',
  'app/study/timer.tsx',
  // task
  'app/task/[id].tsx',
  // timeline
  'app/timeline/[date].tsx',
];

describe('screens report failed reads', () => {
  const offenders = screenFiles(SCREENS)
    .filter((path) => {
      const source = readFileSync(path, 'utf8');
      return readsQueryData(source) && !handlesFailure(source);
    })
    .sort();

  it('has no screen missing an error state outside the known backlog', () => {
    const unexpected = offenders.filter((path) => !KNOWN_GAPS.includes(path));
    expect(unexpected).toEqual([]);
  });

  it('keeps the backlog honest — every entry is still a real gap', () => {
    // A fixed screen left in the list would let it silently regress later, and
    // would overstate the remaining work.
    const stale = KNOWN_GAPS.filter((path) => !offenders.includes(path));
    expect(stale).toEqual([]);
  });

  it('covers the Gallery module, which had no error state on any screen', () => {
    const gallery = offenders.filter((path) => path.startsWith('app/gallery/'));
    expect(gallery).toEqual([]);
  });
});

/**
 * A screen that both creates and edits must never create while editing.
 *
 * Three screens share one shape: `if (isEdit && existing) { update } else {
 * create }`. It is correct while the read succeeds and silently wrong when it
 * does not — a failed read leaves `existing` undefined, the branch falls
 * through, and saving writes a *second* row beside the one the person meant to
 * edit. A duplicate transaction in the ledger, a second night's sleep, a second
 * IOU against the same person, none of them announced.
 *
 * Detected by shape rather than by name so a fourth screen written to the same
 * pattern is caught on the day it is added, which is the only day the guard is
 * cheap to write.
 */
const CREATE_OR_EDIT = /if\s*\(isEdit\s*&&\s*existing\)/;
const GUARDED = /if\s*\(isEdit\s*&&\s*!existing\)\s*return;/;

describe('a create-or-edit screen never creates while editing', () => {
  const screens = screenFiles(SCREENS)
    .map((path) => ({ path, source: readFileSync(path, 'utf8') }))
    .filter(({ source }) => CREATE_OR_EDIT.test(source));

  it('finds the screens that have both paths', () => {
    // Guards the detector itself: a rename that stops it matching would
    // otherwise make every assertion below vacuously true.
    expect(screens.map((s) => s.path).sort()).toEqual([
      'app/budget/debts/new.tsx',
      'app/budget/transaction.tsx',
      'app/sleep/log.tsx',
    ]);
  });

  it.each(screens.map((s) => s.path))('%s refuses to save an edit it could not read', (path) => {
    expect(GUARDED.test(readFileSync(path, 'utf8'))).toBe(true);
  });
});
