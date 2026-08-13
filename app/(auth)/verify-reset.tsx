import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';

import { ChevronBack } from '@/components/ui/directional-icon';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { colors } from '@/constants/theme';
import { OTP_LENGTH, OtpField } from '@/features/auth/components/otp-field';
import { useAuthStore } from '@/features/auth/services/auth-store';
import { useColorScheme } from '@/hooks/use-color-scheme';

/** Same reasoning as verify-signup's: long enough that mashing "resend" can't
 *  flood the inbox, short enough that a genuinely lost code is a short wait. */
const RESEND_COOLDOWN_S = 30;

export default function VerifyResetScreen() {
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ email: string }>();
  const email = params.email ?? '';
  const resetPassword = useAuthStore((s) => s.resetPassword);
  const verifyPasswordResetOtp = useAuthStore((s) => s.verifyPasswordResetOtp);

  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_S);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  const handleVerify = async () => {
    if (code.length !== OTP_LENGTH) {
      setError(t('auth.codeIncomplete'));
      return;
    }
    setBusy(true);
    setError(null);
    const result = await verifyPasswordResetOtp(email, code);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.replace('/(auth)/reset-password');
  };

  const handleResend = async () => {
    if (cooldown > 0) return;
    setResending(true);
    setError(null);
    const result = await resetPassword(email);
    setResending(false);
    if (!result.ok) setError(result.error);
    else setCooldown(RESEND_COOLDOWN_S);
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
          <Text variant="heading">{t('auth.enterCode')}</Text>
          <Text variant="muted">{t('auth.codeSentTo', { email })}</Text>
        </View>

        <View className="gap-4">
          <OtpField
            label={t('auth.verificationCode')}
            value={code}
            onChangeText={setCode}
            autoFocus
          />

          {error && (
            <Text variant="caption" className="text-destructive">
              {error}
            </Text>
          )}

          <Button
            label={busy ? t('auth.verifying') : t('auth.verify')}
            variant="accent"
            size="lg"
            disabled={busy}
            onPress={handleVerify}
          />

          <Button
            label={
              cooldown > 0
                ? t('auth.resendIn', { count: cooldown })
                : resending
                  ? t('auth.sendingCode')
                  : t('auth.resendCode')
            }
            variant="secondary"
            size="lg"
            disabled={cooldown > 0 || resending}
            onPress={() => void handleResend()}
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
