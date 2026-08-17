import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { EmailCodeStep } from '@/features/auth/components/email-code-step';
import { useAuthStore } from '@/features/auth/services/auth-store';

/**
 * Signing in with an emailed code instead of a password.
 *
 * The path that was missing entirely. Sign-up could send a code and sign-in
 * could not, so anyone who created their account with a code and never got as
 * far as choosing a password — or simply forgot it — had no way back in that
 * did not begin with "reset your password".
 *
 * Unlike its two siblings there is nothing to navigate to on success: the code
 * establishes a full session, and `useAuthGate` sends the user to their
 * dashboard, or into onboarding if this account has never finished it. This
 * screen is deliberately NOT in that hook's `PASSWORD_SETUP_SCREENS` — the list
 * of screens it must leave alone — precisely so that redirect happens.
 */
export default function VerifySignInScreen() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ email: string; existing?: string }>();
  const email = params.email ?? '';
  const sendSignInOtp = useAuthStore((s) => s.sendSignInOtp);
  const verifyEmailCode = useAuthStore((s) => s.verifyEmailCode);

  return (
    <EmailCodeStep
      // Reached from the sign-up form when the address turned out to already
      // have an account. Saying so is the whole point: without it, somebody who
      // asked to create an account is handed a code and signed into an existing
      // one with no explanation of what happened to the form they filled in.
      title={params.existing === '1' ? t('auth.youAlreadyHaveAccount') : t('auth.enterCode')}
      subtitle={
        params.existing === '1'
          ? t('auth.accountExistsSignIn', { email })
          : t('auth.codeSentTo', { email })
      }
      verifyLabel={t('auth.signIn')}
      busyLabel={t('auth.signingIn')}
      onVerify={(code) => verifyEmailCode(email, code)}
      onResend={() => sendSignInOtp(email)}
      onVerified={() => {}}
    />
  );
}
