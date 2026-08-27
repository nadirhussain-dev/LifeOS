import { renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';

import { useAppLock } from '@/features/security/hooks/use-app-lock';
import { useAppLockStore } from '@/features/security/store/app-lock-store';

/**
 * When the shield goes up.
 *
 * Both directions of this are user-hostile when wrong, which is why the hook
 * has a carve-out that looks like a bug until you know the story: failing to
 * lock leaves a private journal open on a borrowed phone, and locking too
 * eagerly locks somebody out of their own app seconds after they enabled the
 * setting. The second is the one that actually happened — see the cold-start
 * test below.
 */

const mockProfileState = { appLockEnabled: false, onboardingComplete: true };

jest.mock('@/features/profile/store/profile-store', () => ({
  useProfileStore: Object.assign(
    (selector: (state: typeof mockProfileState) => unknown) => selector(mockProfileState),
    { getState: () => mockProfileState },
  ),
}));

/** The listener the hook registers, captured so a test can drive AppState. */
let changeHandler: ((next: AppStateStatus) => void) | undefined;
const remove = jest.fn();

beforeEach(() => {
  changeHandler = undefined;
  remove.mockClear();
  mockProfileState.appLockEnabled = false;
  mockProfileState.onboardingComplete = true;
  useAppLockStore.setState({ isLocked: false });

  (AppState as unknown as { currentState: AppStateStatus }).currentState = 'active';
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((
    _event: string,
    handler: (next: AppStateStatus) => void,
  ) => {
    changeHandler = handler;
    return { remove };
  }) as unknown as typeof AppState.addEventListener);
});

afterEach(() => jest.restoreAllMocks());

const locked = () => useAppLockStore.getState().isLocked;

describe('cold start', () => {
  it('comes up locked when the lock was already on', async () => {
    mockProfileState.appLockEnabled = true;

    await renderHook(() => useAppLock());

    expect(locked()).toBe(true);
  });

  it('stays open when the lock is off', async () => {
    await renderHook(() => useAppLock());

    expect(locked()).toBe(false);
  });

  it('does not lock mid-onboarding', async () => {
    // The carve-out, and the reason the mount effect reads `getState()` rather
    // than the subscribed value. Turning the lock on during onboarding happens
    // moments after a successful auth; re-locking on that same render would
    // throw up the unlock screen on somebody who had just proved who they were,
    // in the middle of setup.
    mockProfileState.appLockEnabled = true;
    mockProfileState.onboardingComplete = false;

    await renderHook(() => useAppLock());

    expect(locked()).toBe(false);
  });
});

describe('leaving the foreground', () => {
  it('locks on the way out to background, not on the way back', async () => {
    // Locking on exit rather than on return is deliberate: the shield has to be
    // up *before* the app is backgrounded, or the content is briefly visible in
    // the app switcher and again for a frame on resume.
    mockProfileState.appLockEnabled = true;
    mockProfileState.onboardingComplete = false; // isolate from the cold-start lock

    await renderHook(() => useAppLock());
    expect(locked()).toBe(false);

    changeHandler?.('background');

    expect(locked()).toBe(true);
  });

  it('locks on inactive too', async () => {
    // iOS sends `inactive` for the app switcher and for a covering system
    // sheet. Matching only `background` would leave the content readable in the
    // switcher preview.
    mockProfileState.appLockEnabled = true;
    mockProfileState.onboardingComplete = false;

    await renderHook(() => useAppLock());
    changeHandler?.('inactive');

    expect(locked()).toBe(true);
  });

  it('does nothing when the lock is disabled', async () => {
    await renderHook(() => useAppLock());

    changeHandler?.('background');

    expect(locked()).toBe(false);
  });

  it('does not lock when returning to the foreground', async () => {
    // `background → active` must not raise the shield, or unlocking is
    // immediately undone by the very transition that follows it and the app is
    // unusable.
    mockProfileState.appLockEnabled = true;
    mockProfileState.onboardingComplete = false;

    await renderHook(() => useAppLock());

    changeHandler?.('background');
    useAppLockStore.setState({ isLocked: false }); // the person unlocks
    changeHandler?.('active');

    expect(locked()).toBe(false);
  });

  it('ignores a repeated background event from an already-background app', async () => {
    mockProfileState.appLockEnabled = true;
    mockProfileState.onboardingComplete = false;

    await renderHook(() => useAppLock());

    changeHandler?.('background');
    useAppLockStore.setState({ isLocked: false });
    // Still backgrounded: this is not a fresh exit from the foreground, so it
    // must not re-lock a session the person has just unlocked.
    changeHandler?.('background');

    expect(locked()).toBe(false);
  });
});

describe('teardown', () => {
  it('removes its AppState listener on unmount', async () => {
    // The hook is mounted from the root layout, so a leaked subscription here
    // is a leaked subscription for the life of the process.
    const { unmount } = await renderHook(() => useAppLock());

    // Awaited like the render above: RNTL 14 drives React 19's async `act`, so
    // teardown — and the cleanup function that calls `remove` — has not run
    // when `unmount()` returns.
    await unmount();

    expect(remove).toHaveBeenCalled();
  });
});
