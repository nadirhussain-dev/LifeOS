import { useRouter, useSegments } from 'expo-router';
import { useEffect } from 'react';

import { useAuthStore } from '@/features/auth/services/auth-store';
import { onboardingScope } from '@/features/onboarding/services/onboarding-scope';
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
 *
 * Whether somebody counts as onboarded is no longer decided here. It is
 * `onboardingScope()` (features/onboarding/services/onboarding-scope.ts),
 * which is where the reasoning lives and where it is tested — the decision has
 * two opposite failure modes, each of which is the obvious fix for the other,
 * and it was carried as a known bug in TODO.md for exactly that reason. This
 * gate now only routes on the answer.
 */
export function useAuthGate() {
  const segments = useSegments();
  const router = useRouter();
  const isInitialized = useAuthStore((s) => s.isInitialized);
  const session = useAuthStore((s) => s.session);
  const isGuest = useAuthStore((s) => s.isGuest);
  const authHydrated = useAuthStore((s) => s.hasHydrated);
  const profile = useAuthStore((s) => s.profile);
  const onboardingComplete = useProfileStore((s) => s.onboardingComplete);
  const onboardedUserIds = useProfileStore((s) => s.onboardedUserIds);
  const markAccountOnboarded = useProfileStore((s) => s.markAccountOnboarded);
  const hydrated = useProfileStore((s) => s.hydrated);

  useEffect(() => {
    if (!isInitialized || !authHydrated || !hydrated) return;

    const inAuthGroup = segments[0] === '(auth)';
    const inOnboarding = segments[0] === '(onboarding)';
    // These four must stay reachable even once a session appears mid-screen —
    // verifying a signup or recovery code (verify-signup, verify-reset) signs
    // the user in *before* they've picked a password, precisely so the next
    // screen (create-password, reset-password) can set one. Each of those
    // screens navigates on when it's actually done; redirecting away the
    // instant the session appears would skip the step it exists for.
    const PASSWORD_SETUP_SCREENS = [
      'verify-signup',
      'create-password',
      'verify-reset',
      'reset-password',
    ];
    const onPasswordSetupScreen = segments.some((s) => PASSWORD_SETUP_SCREENS.includes(s));
    const authed = !!session || isGuest;

    if (onPasswordSetupScreen) return;

    // `profile` loads asynchronously after sign-in (loadProfile()), so
    // `onboardingCompletedAt` is null for a moment even for an account that
    // finished onboarding long ago. This effect re-runs once it arrives (it is
    // a dependency below), and the local account list is what stops that
    // moment becoming a one-frame trip through onboarding.
    const scope = onboardingScope({
      userId: session?.user.id ?? null,
      onboardedUserIds,
      deviceOnboarded: onboardingComplete,
      accountOnboardedAt: profile?.onboardingCompletedAt ?? null,
    });
    // Writing it down is what makes the answer survive going offline, and what
    // closes the ambiguous case permanently — see onboarding-scope.ts.
    if (scope.adopt && session) markAccountOnboarded(session.user.id);
    const effectivelyOnboarded = scope.onboarded;

    if (!effectivelyOnboarded) {
      // First run. Onboarding owns this phase and reaches into `(auth)` itself
      // for the email path, so being in either group is fine — anywhere else
      // means a deep link jumped the queue.
      //
      // Except once `(auth)` has actually done its job: a sign-up or sign-in
      // completed from onboarding's "use email instead" detour lands here with
      // a real session but onboarding still unfinished. Without this, that
      // login/sign-up screen has nothing left to do and nothing sends the user
      // anywhere — the "successful auth, then nothing happens" bug. Send them
      // back to pick up onboarding where they left off.
      if (inAuthGroup && authed) {
        router.replace('/(onboarding)');
        return;
      }
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
  }, [
    isInitialized,
    authHydrated,
    hydrated,
    session,
    isGuest,
    profile,
    onboardingComplete,
    onboardedUserIds,
    markAccountOnboarded,
    segments,
    router,
  ]);
}
