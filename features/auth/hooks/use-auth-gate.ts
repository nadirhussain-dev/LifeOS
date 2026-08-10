import { useRouter, useSegments } from 'expo-router';
import { useEffect } from 'react';

import { useAuthStore } from '@/features/auth/services/auth-store';
import { useProfileStore } from '@/features/profile/store/profile-store';

/**
 * Routes between first-run onboarding, the auth flow, and the app.
 *
 * Order of gates: **unonboarded → onboarding** (whether or not there is a
 * session); then unauthenticated → login; then the app. Waits for both the
 * session check and the persisted profile so the first frame never flashes the
 * wrong screen. Mounted once from the root layout.
 *
 * The first two gates used to be the other way round, which put a sign-in form
 * in front of every new user before the app had shown it did anything. The
 * account offer now lives inside onboarding, one step past the welcome, so this
 * gate must let an unauthenticated visitor *into* onboarding — which is the whole
 * reason the order changed.
 *
 * Onboarding is deliberately allowed to send people into `(auth)` while it runs
 * ("use email instead", "already have an account"). That is why the redirect out
 * of `(auth)` is conditional on being onboarded: bouncing them straight back
 * would make those two links dead.
 */
export function useAuthGate() {
  const segments = useSegments();
  const router = useRouter();
  const isInitialized = useAuthStore((s) => s.isInitialized);
  const session = useAuthStore((s) => s.session);
  const isGuest = useAuthStore((s) => s.isGuest);
  const authHydrated = useAuthStore((s) => s.hasHydrated);
  const onboardingComplete = useProfileStore((s) => s.onboardingComplete);
  const hydrated = useProfileStore((s) => s.hydrated);

  useEffect(() => {
    if (!isInitialized || !authHydrated || !hydrated) return;

    const inAuthGroup = segments[0] === '(auth)';
    const inOnboarding = segments[0] === '(onboarding)';
    // The reset-password screen must stay reachable even with a session — the
    // recovery link signs the user in precisely so they can set a new password.
    const onResetScreen = segments.includes('reset-password');
    const authed = !!session || isGuest;

    if (onResetScreen) return;

    if (!onboardingComplete) {
      // First run. Onboarding owns this phase and reaches into `(auth)` itself
      // for the email path, so being in either group is fine — anywhere else
      // means a deep link jumped the queue.
      if (!inOnboarding && !inAuthGroup) router.replace('/(onboarding)');
      return;
    }

    if (!authed) {
      // Onboarded but signed out — a returning user, who gets the login screen.
      if (!inAuthGroup) router.replace('/(auth)/login');
      return;
    }

    // Onboarded and in. Leave the onboarding flow; and bounce only a REAL session
    // out of the auth flow — guests are left there so they can upgrade to an
    // account from Settings without being kicked back into the app.
    if (inOnboarding) router.replace('/(tabs)');
    else if (inAuthGroup && session) router.replace('/(tabs)');
  }, [isInitialized, authHydrated, hydrated, session, isGuest, onboardingComplete, segments, router]);
}
