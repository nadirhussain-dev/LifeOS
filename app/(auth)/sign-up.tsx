import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { AuthField } from '@/features/auth/components/auth-field';
import { SocialAuthButtons } from '@/features/auth/components/social-auth-buttons';
import { UsernameField, type UsernameStatus } from '@/features/auth/components/username-field';
import { useAuthStore } from '@/features/auth/services/auth-store';
import { useTheme } from '@/hooks/use-theme';
import { isSupabaseConfigured } from '@/lib/env';
import {
  checkPassword,
  passwordProblemKey,
  PASSWORD_MIN_LENGTH,
} from '@/features/auth/services/password-policy';
import { notify } from '@/lib/dialog-store';

export default function SignUpScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { c } = useTheme();
  const signUp = useAuthStore((s) => s.signUp);
  const claimUsername = useAuthStore((s) => s.claimUsername);

  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>('empty');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSignUp = async () => {
    if (!email.trim() || !password) {
      setError(t('auth.enterEmailPassword'));
      return;
    }
    // The account's own email and name are passed in so a password built out of
    // them is refused — for a phone somebody else may pick up, that is the
    // guess that actually gets tried.
    const strength = checkPassword(password, [email, name, username]);
    if (!strength.ok) {
      setError(t(passwordProblemKey(strength.problem), { min: PASSWORD_MIN_LENGTH }));
      return;
    }
    // 'unavailable' means the availability probe couldn't run, which is not the
    // user's problem and must not wall them out of signing up — claim_username
    // still runs against the unique index afterwards, and that was always the
    // real arbiter. Only a name that is genuinely taken, malformed or missing
    // blocks submission.
    if (usernameStatus !== 'available' && usernameStatus !== 'unavailable') {
      setError(t('auth.usernameRequired'));
      return;
    }
    setBusy(true);
    setError(null);
    const result = await signUp(email, password, name);
    if (!result.ok) {
      setBusy(false);
      setError(result.error);
      return;
    }

    // The account exists now; the name is claimed separately so that losing a
    // race for it can never roll back a successful sign-up. Only possible with
    // a session — with email confirmation on, it's claimed after first log-in.
    if (useAuthStore.getState().session) {
      const claim = await claimUsername(username.trim());
      if (claim !== 'ok') {
        setBusy(false);
        setError(claim === 'taken' ? t('auth.usernameJustTaken') : t('auth.usernameClaimFailed'));
        return;
      }
    }
    setBusy(false);
    // If the project requires email confirmation, there's no session yet.
    if (!useAuthStore.getState().session) {
      // Kept as a dialog, unlike the other confirmations: this one is an
      // instruction to go and do something in another app, and a toast that
      // vanishes after four seconds is the wrong carrier for it. ('OK' was
      // also hardcoded English here, in an app that ships Arabic and Urdu.)
      await notify({
        title: t('auth.checkInbox'),
        message: t('auth.confirmationSent'),
        confirmLabel: t('common.ok'),
      });
      router.replace('/(auth)/login');
    }
    // Otherwise the auth gate redirects into the app automatically.
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
          <Text variant="heading">{t('auth.createYourAccount')}</Text>
          <Text variant="muted">{t('auth.backupSubtitle')}</Text>
        </View>

        {/* A provider account skips this entire form — including having to invent
            a password and a username — so it goes above it. Nothing renders when
            the build has no Supabase credentials. */}
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
            label={t('auth.name')}
            value={name}
            onChangeText={setName}
            placeholder={t('auth.namePlaceholder')}
            autoCapitalize="words"
            autoComplete="name"
          />
          <View className="gap-1.5">
            <Text variant="micro">{t('auth.username')}</Text>
            <UsernameField
              value={username}
              onChangeText={setUsername}
              onStatusChange={setUsernameStatus}
            />
          </View>
          <AuthField
            label={t('auth.email')}
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            keyboardType="email-address"
            autoComplete="email"
          />
          <AuthField
            label={t('auth.password')}
            value={password}
            onChangeText={setPassword}
            placeholder={t('auth.atLeast6')}
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
            onPress={handleSignUp}
          />
        </View>

        <View className="flex-row items-center justify-center gap-1">
          <Text variant="muted">{t('auth.alreadyHaveAccount')}</Text>
          <Link href="/(auth)/login" asChild>
            <Pressable hitSlop={8}>
              <Text className="font-sora-semibold text-accent">{t('auth.signIn')}</Text>
            </Pressable>
          </Link>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
