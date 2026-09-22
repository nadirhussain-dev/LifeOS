import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { EnvironmentPill } from '@/components/ui/environment-badge';
import { Text } from '@/components/ui/text';
import { AuthField } from '@/features/auth/components/auth-field';
import { SocialAuthButtons } from '@/features/auth/components/social-auth-buttons';
import { useAuthStore } from '@/features/auth/services/auth-store';
import { postAuthDestination } from '@/features/auth/services/post-auth-destination';
import { useTheme } from '@/hooks/use-theme';
import { useSplashStore } from '@/hooks/use-splash-store';
import { isSupabaseConfigured } from '@/lib/env';

export default function LoginScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { c } = useTheme();
  const signIn = useAuthStore((s) => s.signIn);
  const sendSignInOtp = useAuthStore((s) => s.sendSignInOtp);
  const continueAsGuest = useAuthStore((s) => s.continueAsGuest);
  // Don't autofocus while the cold-start splash is still up — it would raise
  // the keyboard behind the splash.
  const splashComplete = useSplashStore((s) => s.complete);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);

  const handleSignIn = async () => {
    if (!email.trim() || !password) {
      setError(t('auth.enterEmailPassword'));
      return;
    }
    setBusy(true);
    setError(null);
    const result = await signIn(email, password);
    setBusy(false);
    if (!result.ok) setError(result.error);
    // On success the auth gate redirects automatically.
  };

  /**
   * The passwordless way in. Needs only the email field, so it is reachable
   * without typing a password the user may not have — an account created with
   * a code and abandoned before `create-password` has none at all, and until
   * this existed the only route back into one was "reset your password",
   * which is a strange thing to ask of somebody who never set one.
   */
  const handleEmailCode = async () => {
    if (!email.trim()) {
      setError(t('auth.enterEmail'));
      return;
    }
    setSendingCode(true);
    setError(null);
    const result = await sendSignInOtp(email);
    setSendingCode(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.push({ pathname: '/(auth)/verify-signin', params: { email: email.trim() } });
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1 bg-background"
    >
      <ScrollView
        contentContainerClassName="flex-grow justify-center gap-6 px-6 py-10"
        keyboardShouldPersistTaps="handled"
      >
        {/* Which database this account is about to be created in. Nothing in
            production; see components/ui/environment-badge.tsx. */}
        <EnvironmentPill />

        <View className="gap-2">
          <Text variant="heading">{t('auth.welcomeBack')}</Text>
          <Text variant="muted">{t('auth.signInSubtitle')}</Text>
        </View>

        {!isSupabaseConfigured && (
          <Text variant="caption" className="text-warning">
            {t('auth.cloudSyncOff')}
          </Text>
        )}

        {/* Above the form, because it is the faster path and burying the faster
            path under the slower one is a choice made for the developer's
            convenience. Renders nothing when the build has no credentials. */}
        <SocialAuthButtons onError={setError} disabled={busy} />

        {isSupabaseConfigured && (
          <View className="flex-row items-center gap-3">
            <View className="h-px flex-1" style={{ backgroundColor: c.border }} />
            <Text variant="caption">{t('common.or')}</Text>
            <View className="h-px flex-1" style={{ backgroundColor: c.border }} />
          </View>
        )}

        <View className="gap-4">
          <AuthField
            label={t('auth.email')}
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            keyboardType="email-address"
            autoComplete="email"
            autoFocus={splashComplete}
          />
          <AuthField
            label={t('auth.password')}
            value={password}
            onChangeText={setPassword}
            placeholder={t('auth.passwordPlaceholder')}
            secure
            autoComplete="password"
          />

          <Link href="/(auth)/forgot-password" asChild>
            <Pressable accessibilityRole="link" hitSlop={8} className="self-end">
              <Text variant="caption" className="font-sora-medium">
                {t('auth.forgotPassword')}
              </Text>
            </Pressable>
          </Link>

          {error && (
            <Text variant="caption" className="text-destructive">
              {error}
            </Text>
          )}

          <Button
            label={busy ? t('auth.signingIn') : t('auth.signIn')}
            variant="accent"
            size="lg"
            disabled={busy || sendingCode}
            onPress={handleSignIn}
          />

          {/* Below the password button rather than beside it: this is the
              fallback, and a form with two equally weighted submit buttons
              makes the ordinary case ambiguous. Only visible when there is a
              server to send a code from. */}
          {isSupabaseConfigured && (
            <Button
              label={sendingCode ? t('auth.sendingCode') : t('auth.emailMeACode')}
              variant="secondary"
              size="lg"
              disabled={busy || sendingCode}
              onPress={() => void handleEmailCode()}
            />
          )}
        </View>

        <View className="flex-row items-center justify-center gap-1">
          <Text variant="muted">{t('auth.newHere')}</Text>
          <Link href="/(auth)/sign-up" asChild>
            <Pressable accessibilityRole="link" hitSlop={8}>
              <Text className="font-sora-semibold text-accent">{t('auth.createAccount')}</Text>
            </Pressable>
          </Link>
        </View>

        {/* A real option, not an underlined afterthought.
 
            This app works completely offline and a guest who signs in later
            keeps everything they wrote, so "without an account" is a supported
            way to use it rather than a degraded one — and it was styled as the
            least important thing on the screen. Somebody who opened the app,
            tapped "Sign in" from the welcome screen and then discovered they
            had no account had to find grey underlined text below the fold to
            get out.

            The destination is the shared decision, not `/(tabs)`. Hardcoding
            the tabs here is what stranded a first-time user: the gate would
            notice they were not onboarded and replace them back onto the
            welcome screen they had just come from, so the button looked like it
            had restarted the app. See post-auth-destination.ts. */}
        <Button
          label={t('auth.continueGuest')}
          variant="ghost"
          size="lg"
          onPress={() => {
            continueAsGuest();
            router.replace(postAuthDestination());
          }}
        />
        <Text variant="caption" className="-mt-1 text-center">
          {t('auth.continueGuestHint')}
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
