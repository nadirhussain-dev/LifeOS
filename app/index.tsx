import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';

import { useAuthStore } from '@/features/auth/services/auth-store';
import { useProfileStore } from '@/features/profile/store/profile-store';

export default function Index() {
  const isInitialized = useAuthStore((s) => s.isInitialized);
  const session = useAuthStore((s) => s.session);
  const isGuest = useAuthStore((s) => s.isGuest);
  const authHydrated = useAuthStore((s) => s.hasHydrated);
  const onboardingComplete = useProfileStore((s) => s.onboardingComplete);
  const hydrated = useProfileStore((s) => s.hydrated);

  if (!isInitialized || !authHydrated || !hydrated) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    );
  }

  // Onboarding is checked FIRST, ahead of the session. It used to be the other
  // way round, which meant the first screen of the app was a password field
  // belonging to an app that had not yet shown it did anything. The account
  // offer now lives inside onboarding, one step past a welcome — see
  // app/(onboarding)/index.tsx. Anyone who has already finished setup and has no
  // session is a returning user who signed out, and they still get the login
  // screen.
  if (!onboardingComplete) return <Redirect href="/(onboarding)" />;
  if (!session && !isGuest) return <Redirect href="/(auth)/login" />;
  return <Redirect href="/(tabs)" />;
}
