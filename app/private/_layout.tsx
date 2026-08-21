import { Stack } from 'expo-router';

import { ErrorBoundary } from '@/components/error-boundary';
import { useSecureScreen } from '@/features/private/components/secure-screen';

/**
 * Every private route lives under this layout, which is what guarantees the
 * screenshot block applies to all of them — including any added later, and
 * including the ones a developer forgets. Putting the call on individual
 * screens would make it something to remember, and this is not a good thing to
 * forget once.
 */
export default function PrivateLayout() {
  useSecureScreen();

  return (
    // Confines a render-time throw anywhere in the private space to this
    // segment instead of the single root ErrorBoundary (app/_layout.tsx)
    // tearing down the whole app's navigation state to recover from it.
    <ErrorBoundary>
      <Stack
        screenOptions={{
          headerShown: false,
          // No swipe-back out of the space: the gesture is easy to trigger by
          // accident and lands on whatever was underneath, which on a shared
          // screen is the wrong direction to fail.
          gestureEnabled: false,
        }}
      >
        {/* Declared so it presents as a modal like every other creation screen
            in the app. Bare `<Stack />` gave it the default push, which reads as
            "you are now deeper in the vault" rather than "fill this in or back
            out". `gestureEnabled` stays inherited: a modal that can be swiped
            away is exactly what the screenOptions above rule out. */}
        <Stack.Screen name="albums/new" options={{ presentation: 'modal' }} />
      </Stack>
    </ErrorBoundary>
  );
}
