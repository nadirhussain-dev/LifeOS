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

export default function SignUpScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { c } = useTheme();
  const sendSignupOtp = useAuthStore((s) => s.sendSignupOtp);
  const sendSignInOtp = useAuthStore((s) => s.sendSignInOtp);

  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>('empty');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleContinue = async () => {
    if (!email.trim()) {
      setError(t('auth.enterEmail'));
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

    // Ask for a SIGN-IN code first, which the server refuses (`otp_disabled`)
    // when no account has this address — and refuses without sending anything,
    // so this costs an unregistered address nothing but a round trip.
    //
    // The point is what happens when it succeeds. Signing up with an address
    // that already has an account used to run the whole sign-up flow against
    // it: the code signed the user in, and `create-password` then overwrote the
    // password of the account they already had, from a form that says "Create
    // your account". Nothing warned them, and nothing could be undone. Now that
    // case is what it actually is — a sign-in — and it says so.
    const existing = await sendSignInOtp(email);
    if (existing.ok) {
      setBusy(false);
      router.push({
        pathname: '/(auth)/verify-signin',
        params: { email: email.trim(), existing: '1' },
      });
      return;
    }
    // Anything other than "no account here" is a real failure — the relay being
    // down, a rate limit, a malformed address — and pressing on to the sign-up
    // send would just hit it again and report it a step later.
    if (existing.key !== 'noAccountForEmail') {
      setBusy(false);
      setError(existing.error);
      return;
    }

    const result = await sendSignupOtp(email, name);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.push({
      pathname: '/(auth)/verify-signup',
      params: { email: email.trim(), name: name.trim(), username: username.trim() },
    });
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

        {/* A provider account skips this entire form — including the code and
            the password it leads to — so it goes above it. Nothing renders when
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

          {error && (
            <Text variant="caption" className="text-destructive">
              {error}
            </Text>
          )}

          <Button
            label={busy ? t('auth.sendingCode') : t('common.continue')}
            variant="accent"
            size="lg"
            disabled={busy}
            onPress={handleContinue}
          />
        </View>

        <View className="flex-row items-center justify-center gap-1">
          <Text variant="muted">{t('auth.alreadyHaveAccount')}</Text>
          <Link href="/(auth)/login" asChild>
            <Pressable accessibilityRole="link" hitSlop={8}>
              <Text className="font-sora-semibold text-accent">{t('auth.signIn')}</Text>
            </Pressable>
          </Link>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
