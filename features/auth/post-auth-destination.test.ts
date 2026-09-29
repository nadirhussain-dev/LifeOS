import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

/** Comments describe the old hardcoded redirects; the assertions are about code. */
const code = (path: string) =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

/**
 * Where somebody lands when a screen in the auth stack is finished with them.
 *
 * The rule is one line long — ask `postAuthDestination()` — and it is the kind
 * of rule that is broken silently. Every person who works on this app has an
 * account and has finished onboarding, so a screen that hardcodes `/(tabs)`
 * behaves identically for all of them. It only misbehaves for somebody opening
 * the app for the first time, which is the one population that cannot report it
 * clearly.
 *
 * This is a source scan rather than a set of render tests because the property
 * is about the *set* of exits. A behavioural test for the login screen would
 * have passed while `reset-password` carried the same bug, and no behavioural
 * test can assert "and there is no fifth screen that forgot".
 */
describe('leaving the auth stack', () => {
  const authScreens = () => {
    const out: string[] = [];
    for (const dir of ['app/(auth)', 'app/auth']) {
      for (const entry of readdirSync(join(ROOT, dir))) {
        if (entry.endsWith('.tsx')) out.push(`${dir}/${entry}`);
      }
    }
    return out;
  };

  it('has screens to check at all', () => {
    // Guards the scan itself: a rename that emptied the list would otherwise
    // turn every assertion below into a loop over nothing.
    expect(authScreens().length).toBeGreaterThan(5);
  });

  it('never sends anybody straight to the tabs', () => {
    /*
     * The bug this closes. `login.tsx`'s "continue without an account" did
     * `continueAsGuest(); router.replace('/(tabs)')`, so a first-time user who
     * tapped "Sign in" from the welcome screen, found they had no account, and
     * took the way out landed on the dashboard for a frame before the gate
     * noticed they were not onboarded and replaced them back onto the welcome
     * screen. The button appeared to restart the app.
     *
     * `reset-password.tsx` had the same line for the same reason.
     */
    const offenders = authScreens().filter((path) =>
      /replace\(\s*['"]\/\(tabs\)['"]/.test(code(path)),
    );
    expect(offenders).toEqual([]);
  });

  it('routes every exit through the one decision', () => {
    // A screen that navigates onward under its own power has to ask. Screens
    // that only move *within* the auth stack are not exits and need nothing.
    for (const path of authScreens()) {
      const source = code(path);
      const leavesTheStack = /replace\(\s*(postAuthDestination|['"]\/\((tabs|onboarding)\))/.test(
        source,
      );
      if (!leavesTheStack) continue;
      expect([path, source.includes('postAuthDestination(')]).toEqual([path, true]);
    }
  });

  it('is the only place the onboarding branch is spelled out', () => {
    // Four copies of `onboarded ? '/(tabs)' : '/(onboarding)'` is four chances
    // to write the next one wrong, and two of the four were already wrong.
    const spelledOut = authScreens().filter((path) =>
      /\?\s*['"]\/\(tabs\)['"]\s*:\s*['"]\/\(onboarding\)['"]/.test(code(path)),
    );
    expect(spelledOut).toEqual([]);
  });
});

describe('the way out of the sign-in screen', () => {
  it('is a button rather than underlined text', () => {
    // "Without an account" is a supported way to use this app, not the thing
    // you do when you give up. It was the least prominent element on the
    // screen, below the fold, in grey with an underline.
    const source = read('app/(auth)/login.tsx');
    const guestBlock = source.slice(source.indexOf('continueAsGuest();') - 900);
    expect(guestBlock).toContain('<Button');
    expect(guestBlock).toContain('auth.continueGuest');
  });
});
