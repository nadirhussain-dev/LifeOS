import { useAuthStore } from '@/features/auth/services/auth-store';
import { onboardingScope } from '@/features/onboarding/services/onboarding-scope';
import { useProfileStore } from '@/features/profile/store/profile-store';

/** Where a screen in the auth stack sends somebody once it is finished. */
export type PostAuthDestination = '/(tabs)' | '/(onboarding)';

/**
 * The one answer to "where does this person go now".
 *
 * ## The bug this closes
 *
 * Four screens leave the auth stack under their own power, and until this
 * existed only two of them asked the question. `create-password` and
 * `auth/callback` both read `onboardingScope()` and branched on it; the login
 * screen's "continue without an account" and `reset-password` both hardcoded
 * `router.replace('/(tabs)')`.
 *
 * For a returning user the two are the same and the difference is invisible.
 * For a **first-time** user they are not, and the guest path walks straight
 * into it: open the app, tap "Already have an account? Sign in" on the welcome
 * screen, realise you do not have one, tap "Continue without an account" — and
 * land on the dashboard for a frame before `useAuthGate` notices you are not
 * onboarded and throws you back to the welcome screen you started on. The app
 * appears to have ignored the button and restarted itself, which is a hard
 * thing to interpret as anything other than broken.
 *
 * The same shape sits behind `reset-password`: an account that has never
 * finished onboarding flashes the dashboard on its way into the wizard.
 *
 * ## Why a function and not a copied ternary
 *
 * Four copies of `onboarded ? '/(tabs)' : '/(onboarding)'` is four chances to
 * write the third one wrong, and the failure is silent for everybody who
 * already has an account — which is everybody who works on the app. Reading the
 * stores here rather than taking them as arguments keeps the call sites down to
 * one line and means a new exit from the auth stack cannot forget to pass
 * something.
 *
 * Read imperatively with `getState()` rather than through hooks: every call
 * site is inside an event handler that has just awaited a network round trip,
 * and a value captured at render time is a value from before the sign-in.
 */
export function postAuthDestination(): PostAuthDestination {
  const auth = useAuthStore.getState();
  const profile = useProfileStore.getState();

  const { onboarded } = onboardingScope({
    userId: auth.session?.user.id ?? null,
    onboardedUserIds: profile.onboardedUserIds,
    deviceOnboarded: profile.onboardingComplete,
    accountOnboardedAt: auth.profile?.onboardingCompletedAt ?? null,
  });

  return onboarded ? '/(tabs)' : '/(onboarding)';
}
