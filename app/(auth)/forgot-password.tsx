import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';

import { ChevronBack } from '@/components/ui/directional-icon';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { colors } from '@/constants/theme';
import { AuthField } from '@/features/auth/components/auth-field';
import { useAuthStore } from '@/features/auth/services/auth-store';
import { useColorScheme } from '@/hooks/use-color-scheme';

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const resetPassword = useAuthStore((s) => s.resetPassword);

  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSendCode = async () => {
    if (!email.trim()) {
      setError(t('auth.enterEmail'));
      return;
    }
    setBusy(true);
    setError(null);
    const result = await resetPassword(email);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.push({ pathname: '/(auth)/verify-reset', params: { email: email.trim() } });
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
            label={busy ? t('auth.sendingCode') : t('auth.sendCode')}
            variant="accent"
            size="lg"
            disabled={busy}
            onPress={handleSendCode}
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
