import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';

import { ChevronBack } from '@/components/ui/directional-icon';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { colors } from '@/constants/theme';
import { AuthField } from '@/features/auth/components/auth-field';
import { useAuthStore } from '@/features/auth/services/auth-store';
import { useColorScheme } from '@/hooks/use-color-scheme';

/** Seconds a resend stays disabled for — long enough that mashing the button
 *  can't turn into an inbox full of identical emails, short enough that a
 *  genuinely lost link is a short wait, not a lockout. */
const RESEND_COOLDOWN_S = 30;

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const resetPassword = useAuthStore((s) => s.resetPassword);

  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  const handleReset = async () => {
    if (!email.trim()) {
      setError(t('auth.enterEmail'));
      return;
    }
    if (cooldown > 0) return;
    setBusy(true);
    setError(null);
    const result = await resetPassword(email);
    setBusy(false);
    if (!result.ok) setError(result.error);
    else {
      setSent(true);
      setCooldown(RESEND_COOLDOWN_S);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1 bg-background"
    >
      <ScrollView
        contentContainerClassName="flex-grow gap-6 px-6 py-10"
        keyboardShouldPersistTaps="handled"
      >
        <Pressable
          accessibilityRole="button"
          onPress={() => router.back()}
          hitSlop={10}
          className="h-9 w-9 items-center justify-center rounded-full bg-muted"
        >
          <ChevronBack size={20} color={colors[scheme].foreground} />
        </Pressable>

        <View className="gap-2">
          <Text variant="heading">{t('auth.resetPassword')}</Text>
          <Text variant="muted">{t('auth.resetSubtitle')}</Text>
        </View>

        {sent ? (
          <View className="gap-4">
            <Text>{t('auth.resetSent', { email: email.trim() })}</Text>
            {error && (
              <Text variant="caption" className="text-destructive">
                {error}
              </Text>
            )}
            <Button
              label={
                cooldown > 0
                  ? t('auth.resendIn', { count: cooldown })
                  : busy
                    ? t('auth.sendingLink')
                    : t('auth.resendLink')
              }
              variant="secondary"
              size="lg"
              disabled={cooldown > 0 || busy}
              onPress={() => void handleReset()}
            />
            <Button
              label={t('auth.backToSignIn')}
              variant="accent"
              size="lg"
              onPress={() => router.replace('/(auth)/login')}
            />
          </View>
        ) : (
          <View className="gap-4">
            <AuthField
              label={t('auth.email')}
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              keyboardType="email-address"
              autoComplete="email"
              autoFocus
            />
            {error && (
              <Text variant="caption" className="text-destructive">
                {error}
              </Text>
            )}
            <Button
              label={busy ? t('auth.sendingLink') : t('auth.sendResetLink')}
              variant="accent"
              size="lg"
              disabled={busy}
              onPress={handleReset}
            />
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
