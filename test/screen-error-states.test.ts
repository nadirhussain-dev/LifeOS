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
 * Screens that read from a query and deliberately do not report its failure.
 *
 * Not a backlog — a set of decisions, each of which has to be argued rather
 * than assumed. The default is that a failed read gets said out loud; these
 * are the cases where saying it costs more than it buys, and the test exists
 * to stop the list growing without a reason attached.
 *
 * Two shapes are exempt for opposite reasons:
 *
 *   - the read is *cosmetic*, and blocking the screen would take away the
 *     thing the person came to do, or
 *   - the screen is mid-activity (a playing song, a running timer), where an
 *     error panel interrupts something the failure did not actually break.
 *
 * Where a section of a screen depends on the read but the rest does not, the
 * answer is `InlineError` in that section rather than an entry here — see
 * `settings/media.tsx` and `study/log.tsx`, both of which were on this list
 * until it became clear that an empty catalogue and an empty subject picker
 * each invited a wrong action.
 */
const DEGRADES_BY_DESIGN: Readonly<Record<string, string>> = {
  'app/(auth)/reset-password.tsx':
    'Not a query at all — `const { data } = await supabase.auth.getSession()`. ' +
    'Matched by shape, and the shape is all this scan can see.',
  'app/budget/recurring/new.tsx':
    'Reads settings for a currency symbol it never persists. A failed read ' +
    'shows "USD" beside a field the person is typing an amount into; ' +
    'refusing to render the form would stop them creating the rule at all.',
  'app/budget/savings/new.tsx': 'Same as budget/recurring/new.tsx — the currency is display only.',
  'app/music/now-playing.tsx':
    'The song comes from the player store, not a query. The library read ' +
    'only supplies live favourite state and falls back to the playing song, ' +
    'so a failure costs the accuracy of one star on a screen whose audio is ' +
    'unaffected.',
  'app/study/timer.tsx':
    'The timer is store state; the subjects read only names it. Putting an ' +
    'error panel over a running focus block would interrupt the one thing ' +
    'the failure did not break — and focus mode has already silenced the ' +
    "app's notifications, so the interruption would be the only one.",
};

describe('screens report failed reads', () => {
  const offenders = screenFiles(SCREENS)
    .filter((path) => {
      const source = readFileSync(path, 'utf8');
      return readsQueryData(source) && !handlesFailure(source);
    })
    .sort();

  it('has no screen silently swallowing a failed read', () => {
    const unexplained = offenders.filter((path) => !(path in DEGRADES_BY_DESIGN));
    expect(unexplained).toEqual([]);
  });

  it('keeps every exemption honest — each one is still a real case', () => {
    // An exemption left behind after a screen was fixed would let it regress
    // later under cover of a reason that no longer applies.
    const stale = Object.keys(DEGRADES_BY_DESIGN).filter((path) => !offenders.includes(path));
    expect(stale).toEqual([]);
  });

  it('gives every exemption a reason worth reading', () => {
    // A one-word entry is how this list turns back into a backlog.
    for (const [path, reason] of Object.entries(DEGRADES_BY_DESIGN)) {
      expect(reason.length).toBeGreaterThan(60);
      expect(path).toMatch(/^app\/.*\.tsx$/);
    }
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
