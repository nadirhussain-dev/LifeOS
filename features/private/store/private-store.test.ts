import { usePrivateStore, visiblePrivateModules } from '@/features/private/store/private-store';
import { useProfileStore } from '@/features/profile/store/profile-store';

/**
 * The decoy space unlocks with a non-null key, same as the real one — that is
 * the entire mechanism the decoy depends on (vault-keys.ts). Every module up
 * to shared albums held up under that because their content is encrypted
 * under a key the decoy genuinely does not have, so there was nothing to hide
 * beyond the card itself.
 *
 * Shared albums broke that: membership is ordinary server-side metadata,
 * visible independent of which local key unlocked this device. This is the
 * regression test for the fix — `requiresRealSpace` modules must never
 * appear while `space !== 'real'`, even with a non-null key and the module
 * switched on.
 */
describe('visiblePrivateModules', () => {
  afterEach(() => {
    usePrivateStore.getState().reset();
    usePrivateStore.getState().lock();
  });

  it('returns nothing while locked', () => {
    usePrivateStore.setState({
      key: null,
      space: null,
      enabledModules: ['shared-albums', 'vault'],
    });
    expect(visiblePrivateModules()).toEqual([]);
  });

  it('shows every enabled module in the real space', () => {
    const key = new Uint8Array(32);
    usePrivateStore.getState().unlock(key, 'real');
    usePrivateStore.getState().setEnabledModules(['vault', 'shared-albums']);
    expect(visiblePrivateModules()).toEqual(['vault', 'shared-albums']);
  });

  it('hides a requiresRealSpace module in the decoy space, even though the key is non-null', () => {
    const key = new Uint8Array(32);
    usePrivateStore.getState().unlock(key, 'decoy');
    usePrivateStore.getState().setEnabledModules(['vault', 'shared-albums']);
    expect(visiblePrivateModules()).toEqual(['vault']);
  });

  it('never includes shared-albums in the decoy space regardless of enabledModules order', () => {
    const key = new Uint8Array(32);
    usePrivateStore.getState().unlock(key, 'decoy');
    // Role-gate bypassed on purpose: this test is about requiresRealSpace
    // filtering, unrelated to the gender gate visiblePrivateModules() also
    // applies (see the describe block below) — without this, cycle/recovery
    // would be stripped too, for an unset gender, muddying what's tested here.
    usePrivateStore.getState().setShowAllModules(true);
    usePrivateStore
      .getState()
      .setEnabledModules(['shared-albums', 'cycle', 'recovery', 'intimacy']);
    const visible = visiblePrivateModules();
    expect(visible).not.toContain('shared-albums');
    expect(visible).toEqual(['cycle', 'recovery', 'intimacy']);
  });
});

/**
 * `visiblePrivateModules()` also re-applies `filterByRole()` (private-
 * modules.ts) rather than trusting `enabledModules` as-is — see its own
 * header comment for why: `enabledModules` can hold a hard-gated module from
 * a moment `showAllModules` was briefly on, and toggling it back off never
 * removes anything already enabled.
 */
describe('visiblePrivateModules role gating', () => {
  afterEach(() => {
    usePrivateStore.getState().reset();
    usePrivateStore.getState().lock();
    useProfileStore.getState().reset();
  });

  it('hides a hard-gated module left in enabledModules once showAllModules is off', () => {
    const key = new Uint8Array(32);
    useProfileStore.getState().setGender('male');
    usePrivateStore.getState().unlock(key, 'real');
    // Simulates the stale-entry scenario: cycle was enabled while showAll was
    // on, then showAll was switched back off without removing it.
    usePrivateStore.getState().setEnabledModules(['vault', 'cycle']);
    usePrivateStore.getState().setShowAllModules(false);
    expect(visiblePrivateModules()).toEqual(['vault']);
  });

  it('keeps a hard-gated module visible once showAllModules is on', () => {
    const key = new Uint8Array(32);
    useProfileStore.getState().setGender('male');
    usePrivateStore.getState().unlock(key, 'real');
    usePrivateStore.getState().setEnabledModules(['vault', 'cycle']);
    usePrivateStore.getState().setShowAllModules(true);
    expect(visiblePrivateModules()).toEqual(['vault', 'cycle']);
  });
});
