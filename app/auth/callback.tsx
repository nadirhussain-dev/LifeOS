import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { colors } from '@/constants/theme';
import { exchangeOAuthCode } from '@/features/auth/services/oauth';
import { useAuthStore } from '@/features/auth/services/auth-store';
import { useProfileStore } from '@/features/profile/store/profile-store';
import { useColorScheme } from '@/hooks/use-color-scheme';

/**
 * Where a provider sign-in comes back to.
 *
 * ## Why this file has to exist
 *
 * `oauthRedirectUrl()` is `daykeep://auth/callback`, and the happy path never
 * touches this screen: `openAuthSessionAsync` intercepts that URL inside the
 * browser session and hands it straight back to `signInWithGoogle`.
 *
 * The happy path is not the only path. On Android the redirect is resolved by
 * the OS, which launches the app by intent — and if the session was not the
 * thing that caught it (the app was evicted while the user was on Google's
 * consent screen, the flow finished in an external browser, the Custom Tab was
 * restored into a new task), the URL arrives at the router instead. With no
 * route at this path the router has nowhere to send it, and a completed sign-in
 * ends on **"Unmatched Route — page could not be found"**, with a perfectly good
 * authorisation code visible in the URL underneath.
 *
 * So this is not a redundant second implementation of the exchange. It is the
 * half of the flow that runs when the in-app one could not.
 *
 * ## Why it navigates itself
 *
 * `useAuthGate` moves people between `(auth)`, `(onboarding)` and `(tabs)`.
 * This route is in none of those groups, so the gate's final branch — which
 * only redirects *out of* onboarding or *out of* the auth flow — does not fire,
 * and a signed-in user would sit here indefinitely. Landing on the right screen
 * is therefore this screen's own job, exactly as it is `create-password`'s.
 */
export default function AuthCallbackScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const scheme = useColorScheme() ?? 'light';
  const theme = colors[scheme];
  const params = useLocalSearchParams<{
    code?: string;
    error?: string;
    error_description?: string;
  }>();

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let abandoned = false;

    const finish = () => {
      // Same reasoning as create-password's ending: `profile` is still loading
      // for a moment after sign-in, so a returning user can briefly look new.
      // The gate corrects that as soon as it arrives — it redirects out of
      // onboarding the moment the account turns out to be onboarded.
      const deviceOnboarded = useProfileStore.getState().onboardingComplete;
      const accountOnboarded = useAuthStore.getState().profile?.onboardingCompletedAt != null;
      router.replace(deviceOnboarded || accountOnboarded ? '/(tabs)' : '/(onboarding)');
    };

    void (async () => {
      // Google reports a refusal in the URL rather than by failing the request.
      // `access_denied` is what the Cancel button produces, and it is not an
      // error — it is somebody changing their mind, and it should leave them
      // back where they started without a red line.
      if (params.error) {
        if (params.error === 'access_denied') {
          router.replace('/(auth)/login');
          return;
        }
        setError(params.error_description ?? params.error);
        return;
      }

      if (!params.code) {
        // Nothing to exchange. If a session already exists the in-app path
        // finished this before the deep link arrived, which is the ordinary
        // race rather than a fault.
        if (useAuthStore.getState().session) finish();
        else setError(t('auth.callbackNoCode'));
        return;
      }

      const result = await exchangeOAuthCode(params.code);
      if (abandoned) return;
      if (!result.ok) {
        setError(result.error || t('auth.callbackFailed'));
        return;
      }
      finish();
    })();

    return () => {
      abandoned = true;
    };
    // Runs once for the URL this screen was opened with. A re-run would try to
    // exchange a code that has already been spent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) {
    return (
      <View className="flex-1 items-center justify-center gap-5 bg-background px-8">
        <Text variant="heading" className="text-center">
          {t('auth.callbackFailedTitle')}
        </Text>
        <Text variant="muted" className="text-center">
          {error}
        </Text>
        <Button
          label={t('auth.backToSignIn')}
          variant="accent"
          size="lg"
          className="w-full"
          onPress={() => router.replace('/(auth)/login')}
        />
      </View>
    );
  }

  return (
    <View className="flex-1 items-center justify-center gap-4 bg-background px-8">
      <ActivityIndicator color={theme.accent} />
      <Text variant="muted">{t('auth.finishingSignIn')}</Text>
    </View>
  );
}
