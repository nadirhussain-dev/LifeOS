import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { useProfileStore } from '@/features/profile/store/profile-store';
import { useAppLockStore } from '@/features/security/store/app-lock-store';

/**
 * Drives the app lock: raises the shield on cold start (if enabled) and again
 * whenever the app returns from the background, so Daykeep is private the moment
 * it's reopened. Mounted once from the root layout. Renders nothing.
 */
export function useAppLock() {
  const enabled = useProfileStore((s) => s.appLockEnabled);
  const lock = useAppLockStore((s) => s.lock);
  const appState = useRef<AppStateStatus>(AppState.currentState);

  // Cold start: if the lock was already on when the app launched, come up
  // locked. Runs exactly once and reads the value at mount, so turning the lock
  // ON during onboarding (right after a successful auth) does NOT immediately
  // re-lock the person out.
  useEffect(() => {
    const { appLockEnabled, onboardingComplete } = useProfileStore.getState();
    if (appLockEnabled && onboardingComplete) lock();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-lock every time the app goes to the background, so returning requires
  // re-auth. We lock on the way *out* so the covered content is never briefly
  // visible on the way back in.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      const leftForeground = appState.current === 'active' && next.match(/inactive|background/);
      if (enabled && leftForeground) lock();
      appState.current = next;
    });
    return () => sub.remove();
  }, [enabled, lock]);
}
