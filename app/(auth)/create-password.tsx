import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { AuthField } from '@/features/auth/components/auth-field';
import { useAuthStore } from '@/features/auth/services/auth-store';
import {
  checkPassword,
  passwordProblemKey,
  PASSWORD_MIN_LENGTH,
} from '@/features/auth/services/password-policy';
import { postAuthDestination } from '@/features/auth/services/post-auth-destination';
import { useSplashStore } from '@/hooks/use-splash-store';

export default function CreatePasswordScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ username: string }>();
  const updatePassword = useAuthStore((s) => s.updatePassword);
  const claimUsername = useAuthStore((s) => s.claimUsername);
  const profile = useAuthStore((s) => s.profile);
  const splashComplete = useSplashStore((s) => s.complete);

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async () => {
    // The account's own email and name are passed in so a password built out of
    // them is refused — for a phone somebody else may pick up, that is the
    // guess that actually gets tried.
    const strength = checkPassword(password, [profile?.email ?? '', profile?.displayName ?? '']);
    if (!strength.ok) {
      setError(t(passwordProblemKey(strength.problem), { min: PASSWORD_MIN_LENGTH }));
      return;
    }
    if (password !== confirm) {
      setError(t('auth.passwordsDontMatch'));
      return;
    }
    setBusy(true);
    setError(null);
    const result = await updatePassword(password);
    if (!result.ok) {
      setBusy(false);
      setError(result.error);
      return;
    }

    // The account exists now; the name is claimed separately so that losing a
    // race for it can never roll back a successful sign-up.
    const username = params.username?.trim();
    if (username) {
      const claim = await claimUsername(username);
      if (claim !== 'ok') {
        setBusy(false);
        setError(claim === 'taken' ? t('auth.usernameJustTaken') : t('auth.usernameClaimFailed'));
        return;
      }
    }
    setBusy(false);
    // This screen is one the auth gate deliberately leaves alone (see
    // use-auth-gate.ts's PASSWORD_SETUP_SCREENS) so the session `verifyEmailCode`
    // created doesn't bounce the user out before they've set a password — so
    // unlike most auth actions, navigating onward is this screen's own job.
    // A brand-new account has no onboardingCompletedAt yet; an existing one
    // redoing this flow (passwordless sign-in re-used the sign-up form) does.
    router.replace(postAuthDestination());
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
          <Text variant="heading">{t('auth.chooseAPassword')}</Text>
          <Text variant="muted">{t('auth.chooseAPasswordSubtitle')}</Text>
        </View>

        <View className="gap-4">
          <AuthField
            label={t('auth.password')}
            value={password}
            onChangeText={setPassword}
            placeholder={t('auth.atLeast6')}
            secure
            autoComplete="new-password"
            autoFocus={splashComplete}
          />
          <AuthField
            label={t('auth.confirmPassword')}
            value={confirm}
            onChangeText={setConfirm}
            placeholder={t('auth.reenterPassword')}
            secure
            autoComplete="new-password"
          />

          {error && (
            <Text variant="caption" className="text-destructive">
              {error}
            </Text>
          )}

          <Button
            label={busy ? t('auth.creatingAccount') : t('auth.createAccount')}
            variant="accent"
            size="lg"
            disabled={busy}
            onPress={handleSubmit}
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
