import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { EmailCodeStep } from '@/features/auth/components/email-code-step';
import { useAuthStore } from '@/features/auth/services/auth-store';

/**
 * The code that authorises setting a new password.
 *
 * Verified with `type: 'recovery'` rather than `'email'`: a recovery code
 * establishes the short-lived session `reset-password` writes against, and the
 * two token types are not interchangeable — a recovery code presented as an
 * email code is refused.
 */
export default function VerifyResetScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ email: string }>();
  const email = params.email ?? '';
  const resetPassword = useAuthStore((s) => s.resetPassword);
  const verifyPasswordResetOtp = useAuthStore((s) => s.verifyPasswordResetOtp);

  return (
    <EmailCodeStep
      title={t('auth.enterCode')}
      subtitle={t('auth.codeSentTo', { email })}
      verifyLabel={t('auth.verify')}
      busyLabel={t('auth.verifying')}
      onVerify={(code) => verifyPasswordResetOtp(email, code)}
      onResend={() => resetPassword(email)}
      onVerified={() => router.replace('/(auth)/reset-password')}
    />
  );
}
