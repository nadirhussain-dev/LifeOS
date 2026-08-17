import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { EmailCodeStep } from '@/features/auth/components/email-code-step';
import { useAuthStore } from '@/features/auth/services/auth-store';

/**
 * The code that proves the address on a new account is real.
 *
 * Verifying signs the user in — that is how GoTrue works, and it is deliberate
 * here: `create-password` needs a session to set a password against. The auth
 * gate leaves both screens alone (`PASSWORD_SETUP_SCREENS`) so that session
 * does not bounce the user into the app before the account has a password.
 */
export default function VerifySignupScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ email: string; name: string; username: string }>();
  const email = params.email ?? '';
  const sendSignupOtp = useAuthStore((s) => s.sendSignupOtp);
  const verifyEmailCode = useAuthStore((s) => s.verifyEmailCode);

  return (
    <EmailCodeStep
      title={t('auth.enterCode')}
      subtitle={t('auth.codeSentTo', { email })}
      verifyLabel={t('auth.verify')}
      busyLabel={t('auth.verifying')}
      onVerify={(code) => verifyEmailCode(email, code)}
      onResend={() => sendSignupOtp(email, params.name)}
      onVerified={() =>
        router.replace({
          pathname: '/(auth)/create-password',
          params: { username: params.username ?? '' },
        })
      }
    />
  );
}
