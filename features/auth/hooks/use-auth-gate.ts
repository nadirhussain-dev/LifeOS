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
 *
 * `onboardingComplete` is otherwise a per-device flag, which used to mean a
 * returning user signing in on a device that has never seen their account
 * before (a fresh install, a reset phone) landed back in the welcome flow
 * instead of their dashboard — indistinguishable, from here, from a genuinely
 * new account. Migration 0042's `profile.onboardingCompletedAt` (set once,
 * on whichever device finishes onboarding first) is what lets this gate tell
 * the two apart: `accountOnboarded` below is that server signal, and the
 * moment it's seen this device adopts it as its own local flag too, so it is
 * never checked again after the first sign-in.
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
  const setOnboardingComplete = useProfileStore((s) => s.setOnboardingComplete);
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

    // `profile` loads asynchronously after sign-in (loadProfile()), so this
    // is null for a moment even for an account that finished onboarding long
    // ago — this effect re-runs once it arrives (it's a dependency below),
    // correcting a possible one-frame trip through onboarding rather than
    // blocking navigation until the network round-trip finishes.
    const accountOnboarded = !!session && profile?.onboardingCompletedAt != null;
    if (accountOnboarded && !onboardingComplete) setOnboardingComplete(true);
    const effectivelyOnboarded = onboardingComplete || accountOnboarded;

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
    setOnboardingComplete,
    segments,
    router,
  ]);
}
