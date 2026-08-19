import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';

import { useAuthStore } from '@/features/auth/services/auth-store';
import { onboardingScope } from '@/features/onboarding/services/onboarding-scope';
import { useProfileStore } from '@/features/profile/store/profile-store';

export default function Index() {
  const isInitialized = useAuthStore((s) => s.isInitialized);
  const session = useAuthStore((s) => s.session);
  const isGuest = useAuthStore((s) => s.isGuest);
  const authHydrated = useAuthStore((s) => s.hasHydrated);
  const onboardingComplete = useProfileStore((s) => s.onboardingComplete);
  const onboardedUserIds = useProfileStore((s) => s.onboardedUserIds);
  const profile = useAuthStore((s) => s.profile);
  const hydrated = useProfileStore((s) => s.hydrated);

  if (!isInitialized || !authHydrated || !hydrated) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    );
  }

  // Whether this person has been onboarded is the gate's decision, made by the
  // same function so the two cannot disagree. This screen only picks the first
  // destination — `useAuthGate` would correct a wrong one a frame later — but
  // "correct it a frame later" means a new account on somebody else's phone
  // visibly lands in the app before being pulled back out, which is a worse
  // first impression than going to the right place. See
  // features/onboarding/services/onboarding-scope.ts.
  const { onboarded } = onboardingScope({
    userId: session?.user.id ?? null,
    onboardedUserIds,
    deviceOnboarded: onboardingComplete,
    accountOnboardedAt: profile?.onboardingCompletedAt ?? null,
  });

  // Onboarding is checked FIRST, ahead of the session. It used to be the other
  // way round, which meant the first screen of the app was a password field
  // belonging to an app that had not yet shown it did anything. The account
  // offer now lives inside onboarding, one step past a welcome — see
  // app/(onboarding)/index.tsx. Anyone who has already finished setup and has
  // no session is a returning user who signed out, and they still get login.
  if (!onboarded) return <Redirect href="/(onboarding)" />;
  if (!session && !isGuest) return <Redirect href="/(auth)/login" />;
  return <Redirect href="/(tabs)" />;
}
