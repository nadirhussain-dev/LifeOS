import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * That every screen a person can type into asks before throwing the typing away.
 *
 * This is a wiring test rather than a behavioural one because the failure it
 * guards against is an omission, not a bug: the guard works fine on the screens
 * that call it, and a new create/edit screen that simply never calls it loses
 * work exactly as all eighteen of them used to. Nothing at runtime notices a
 * missing hook. A test that enumerates the form screens does.
 *
 * ## Adding a screen here
 *
 * If a new screen lands in `FORM_SCREENS` and genuinely holds no user input —
 * a confirmation step, a picker that commits on tap — take it out of the list
 * with a comment saying why, rather than adding a `useUnsavedChanges(false)`
 * that reads as protection and provides none.
 */

const ROOT = join(__dirname, '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

/**
 * Screens whose own file owns the form state.
 *
 * `app/habit/new`, `app/habit/[id]/edit`, `app/goals/new` and `app/goals/[id]/edit`
 * are deliberately absent: they mount `HabitForm` / `GoalForm`, which hold the
 * react-hook-form state and therefore the guard. Those two components are
 * checked separately below.
 */
const FORM_SCREENS = [
  'app/task/new.tsx',
  'app/note/new.tsx',
  'app/routine/new.tsx',
  'app/timeline/event/new.tsx',
  'app/sleep/log.tsx',
  'app/study/log.tsx',
  'app/goals/[id]/log.tsx',
  'app/budget/transaction.tsx',
  'app/budget/debts/new.tsx',
  'app/budget/savings/new.tsx',
  'app/budget/recurring/new.tsx',
  'app/gallery/album/new.tsx',
  'app/music/playlist/new.tsx',
  'app/split/new.tsx',
  'app/private/albums/new.tsx',
];

/** The form components that own their screens' state instead. */
const FORM_COMPONENTS = [
  'features/habits/components/habit-form.tsx',
  'features/goals/components/goal-form.tsx',
];

describe('unsaved-changes protection', () => {
  it.each([...FORM_SCREENS, ...FORM_COMPONENTS])('is wired into %s', (path) => {
    expect(read(path)).toContain('useUnsavedChanges(');
  });

  /**
   * A guard that is never released turns every successful save into a
   * "discard your changes?" prompt on the way out — worse than no guard,
   * because it trains people to dismiss the question without reading it.
   */
  it.each([...FORM_SCREENS, ...FORM_COMPONENTS])('releases before leaving %s', (path) => {
    expect(read(path)).toContain('release()');
  });
});

describe('the hook itself', () => {
  const source = read('hooks/use-unsaved-changes.ts');

  /** `beforeRemove` cannot stop a native-stack modal being swiped away; this is
   *  the v7 hook that can, and the forms are all presented modals. */
  it('prevents removal at the navigator, not at each close button', () => {
    expect(source).toContain('usePreventRemove');
  });

  /**
   * The bypass has to be a ref. `release()` is called immediately before
   * `router.back()`, in the same tick — a `useState` flag would not have
   * re-rendered by then, so prevention would still be armed and the save would
   * prompt anyway.
   */
  it('bypasses via a ref so release takes effect in the same tick', () => {
    expect(source).toContain('useRef');
    expect(source).not.toMatch(/useState/);
  });

  /** Four shipped locales, two of them RTL — a hardcoded English prompt here
   *  would be the one untranslated dialog in the app. */
  it('asks the question in the user’s language', () => {
    for (const key of ['discardTitle', 'discardBody', 'discard', 'keepEditing']) {
      expect(source).toContain(`common.${key}`);
    }
  });
});
