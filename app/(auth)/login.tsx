import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { AuthField } from '@/features/auth/components/auth-field';
import { SocialAuthButtons } from '@/features/auth/components/social-auth-buttons';
import { useAuthStore } from '@/features/auth/services/auth-store';
import { useTheme } from '@/hooks/use-theme';
import { useSplashStore } from '@/hooks/use-splash-store';
import { isSupabaseConfigured } from '@/lib/env';

export default function LoginScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { c } = useTheme();
  const signIn = useAuthStore((s) => s.signIn);
  const continueAsGuest = useAuthStore((s) => s.continueAsGuest);
  // Don't autofocus while the cold-start splash is still up — it would raise
  // the keyboard behind the splash.
  const splashComplete = useSplashStore((s) => s.complete);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1 bg-background"
    >
      <ScrollView
        contentContainerClassName="flex-grow justify-center gap-6 px-6 py-10"
        keyboardShouldPersistTaps="handled"
      >
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
            <Pressable hitSlop={8} className="self-end">
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
            disabled={busy}
            onPress={handleSignIn}
          />
        </View>

        <View className="flex-row items-center justify-center gap-1">
          <Text variant="muted">{t('auth.newHere')}</Text>
          <Link href="/(auth)/sign-up" asChild>
            <Pressable hitSlop={8}>
              <Text className="font-sora-semibold text-accent">{t('auth.createAccount')}</Text>
            </Pressable>
          </Link>
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={() => {
            continueAsGuest();
            router.replace('/(tabs)');
          }}
          className="items-center py-2"
        >
          <Text variant="muted" className="underline">
            {t('auth.continueGuest')}
          </Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
