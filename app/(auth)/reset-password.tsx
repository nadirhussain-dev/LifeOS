import { useURL } from 'expo-linking';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
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
import { useSplashStore } from '@/hooks/use-splash-store';
import { supabase } from '@/lib/supabase';
import { toast } from '@/lib/toast-store';

/** Pulls the recovery tokens out of a Supabase reset link (they arrive in the
 * URL hash fragment, e.g. daykeep://reset-password#access_token=...&type=recovery). */
function parseRecoveryTokens(url: string): { accessToken: string; refreshToken: string } | null {
  const fragment = url.includes('#')
    ? url.slice(url.indexOf('#') + 1)
    : url.slice(url.indexOf('?') + 1);
  const params = new URLSearchParams(fragment);
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (!accessToken || !refreshToken) return null;
  return { accessToken, refreshToken };
}

export default function ResetPasswordScreen() {
  const router = useRouter();
  const url = useURL();
  const { t } = useTranslation();
  const updatePassword = useAuthStore((s) => s.updatePassword);
  const splashComplete = useSplashStore((s) => s.complete);

  const [ready, setReady] = useState(false);
  const [checking, setChecking] = useState(true);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Establish the recovery session from the link so updateUser can set a new
  // password. If there's already a session (link handled once), we're ready too.
  useEffect(() => {
    let active = true;
    (async () => {
      const tokens = url ? parseRecoveryTokens(url) : null;
      if (tokens) {
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: tokens.accessToken,
          refresh_token: tokens.refreshToken,
        });
        if (active) {
          setReady(!sessionError);
          setChecking(false);
        }
        return;
      }
      const { data } = await supabase.auth.getSession();
      if (active) {
        setReady(!!data.session);
        setChecking(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [url]);

  const handleUpdate = async () => {
    // The same floor as sign-up. A reset is exactly when somebody reaches for
    // the weakest thing they will remember.
    const strength = checkPassword(password, [
      useAuthStore.getState().profile?.email ?? '',
      useAuthStore.getState().profile?.displayName ?? '',
    ]);
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
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    // Straight in, with the confirmation trailing. A dialog whose only button
    // is "Continue" asks the user to acknowledge something they just did.
    toast.success(t('auth.allSet'));
    router.replace('/(tabs)');
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
          <Text variant="heading">{t('auth.setNewPassword')}</Text>
          <Text variant="muted">{t('auth.chooseNewPassword')}</Text>
        </View>

        {checking ? (
          <Text variant="muted">{t('auth.verifyingLink')}</Text>
        ) : !ready ? (
          <View className="gap-4">
            <Text>{t('auth.linkInvalid')}</Text>
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
              label={t('auth.newPassword')}
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
              label={busy ? t('auth.updating') : t('auth.updatePassword')}
              variant="accent"
              size="lg"
              disabled={busy}
              onPress={handleUpdate}
            />
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
