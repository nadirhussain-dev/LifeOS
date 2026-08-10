import { usePrivateStore, visiblePrivateModules } from '@/features/private/store/private-store';

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
    usePrivateStore
      .getState()
      .setEnabledModules(['shared-albums', 'cycle', 'recovery', 'intimacy']);
    const visible = visiblePrivateModules();
    expect(visible).not.toContain('shared-albums');
    expect(visible).toEqual(['cycle', 'recovery', 'intimacy']);
  });
});
