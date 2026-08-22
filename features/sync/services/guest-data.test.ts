import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { GUEST_SENTINEL, useSyncStore } from '@/features/sync/store/sync-store';

const ROOT = join(__dirname, '..', '..', '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

/**
 * What happens to the data a guest built, the first time they sign in.
 *
 * This was silent, irreversible data loss shipped against a promise made on
 * screen. `continueAsGuest()` stamps `lastUserId = '__guest__'`, which is
 * `!== uid` like any other prior account — so the account-switch branch fired
 * and `wipeLocalData()` cleared the local database, while the account step was
 * still telling the user "sign in later and everything you have already written
 * comes with you" and TODO.md described the migration as automatic.
 *
 * Nothing caught it because nothing tested the guest path at all: every test
 * and every developer signs in on a device that has already signed in.
 */

describe('the promise the account step makes', () => {
  it('is still on the screen, so the behaviour has something to match', () => {
    /*
     * Anchored here rather than left implicit, because the failure mode is the
     * two drifting apart in either direction — code that wipes under copy that
     * promises, or copy quietly softened to excuse the code. If this promise is
     * ever withdrawn, the tests below are what should be revisited with it.
     */
    const en = JSON.parse(read('lib/i18n/locales/en.json'));
    expect(en.onboarding.perkNothingLost).toMatch(/comes with you/i);
  });
});

describe('reconciling a sign-in', () => {
  it('treats a guest as a question, not as an account switch', () => {
    const source = read('features/sync/services/account-reconcile.ts');
    const body = source.slice(source.indexOf('export function reconcileAccountOnSignIn'));

    const guestBranch = body.indexOf('previous === GUEST_SENTINEL');
    const switchBranch = body.indexOf('previous && previous !== uid');

    // The guest case has to be decided *before* the generic switch, or it falls
    // into it — which is exactly how the wipe happened.
    expect(guestBranch).toBeGreaterThan(-1);
    expect(switchBranch).toBeGreaterThan(-1);
    expect(guestBranch).toBeLessThan(switchBranch);

    // And it must not wipe on the way past.
    const guestCase = body.slice(guestBranch, switchBranch);
    expect(guestCase).toContain('setPendingGuestData');
    expect(guestCase).not.toContain('wipeLocalData');
  });

  it('still wipes a genuine account switch', () => {
    // The protection this whole file exists for. Person A's rows must never be
    // pushed up under person B's uid.
    const source = read('features/sync/services/account-reconcile.ts');
    const switchCase = source.slice(source.indexOf('previous && previous !== uid'));
    expect(switchCase.slice(0, 400)).toContain('wipeLocalData()');
  });
});

describe('sync while the question is open', () => {
  it('is held, including against the manual button', () => {
    /*
     * Pushing before the answer settles the question by doing it: the rows land
     * under the new uid and "start fresh" stops being available. The `force`
     * path is deliberately not exempt — tapping "Sync now" is not an answer to
     * a question it does not mention.
     */
    const source = read('features/sync/services/sync-engine.ts');
    const run = source.slice(source.indexOf('async function runSync'));
    const hold = run.indexOf('store.pendingGuestData');
    const forceCheck = run.indexOf('if (!force)');

    expect(hold).toBeGreaterThan(-1);
    expect(forceCheck).toBeGreaterThan(-1);
    expect(hold).toBeLessThan(forceCheck);
  });
});

describe('the prompt', () => {
  const hook = read('features/sync/hooks/use-guest-data-prompt.ts');

  it('makes discarding the named choice and keeping the dismissal', () => {
    /*
     * `confirm()` resolves false when the dialog is dismissed, so whichever
     * branch is wired to `false` is the one a stray tap, a back gesture or a
     * phone call selects. That has to be the branch that keeps somebody's
     * journal.
     */
    expect(hook).toMatch(/confirmLabel: i18n\.t\('sync\.guestDataDiscard'\)/);
    expect(hook).toMatch(/cancelLabel: i18n\.t\('sync\.guestDataKeep'\)/);
    expect(hook).toMatch(/discard \? 'discard' : 'keep'/);
  });

  it('is mounted at the root, not on a screen', () => {
    // Sign-in completes on the onboarding account step, inside the auth stack,
    // or from a deep link on a cold start. A hook on one screen misses two.
    expect(read('app/_layout.tsx')).toContain('useGuestDataPrompt()');
  });
});

describe('the pending question survives a restart', () => {
  it('is persisted, so force-quitting does not answer it', () => {
    // Unanswered has to stay unanswered. If this were runtime-only, killing the
    // app would clear the flag, release the sync hold, and push the data up —
    // silently choosing "keep" on the user's behalf, which is the whole class
    // of bug this replaced.
    const source = read('features/sync/store/sync-store.ts');
    const partialize = source.slice(source.indexOf('partialize:'));
    expect(partialize.slice(0, 400)).toContain('pendingGuestData');
  });

  it('starts clear on a device nobody has signed into', () => {
    expect(useSyncStore.getState().pendingGuestData).toBeNull();
  });

  it('uses the same sentinel the guest choice stamps', () => {
    // Two spellings of '__guest__' would mean the branch never fires and the
    // wipe returns, with nothing to show for it.
    expect(GUEST_SENTINEL).toBe('__guest__');
    expect(read('features/auth/services/auth-store.ts')).toContain(
      'sync.setLastUserId(GUEST_SENTINEL)',
    );
  });
});
