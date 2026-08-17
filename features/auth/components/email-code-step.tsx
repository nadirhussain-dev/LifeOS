import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { ChevronBack } from '@/components/ui/directional-icon';
import { Text } from '@/components/ui/text';
import { colors } from '@/constants/theme';
import { OTP_LENGTH, OtpField } from '@/features/auth/components/otp-field';
import type { AuthResult } from '@/features/auth/services/auth-store';
import { useColorScheme } from '@/hooks/use-color-scheme';

/**
 * "We emailed you a code" — the one screen behind signing up, signing in with a
 * code, and resetting a password.
 *
 * All three had their own copy of this, which is how they came to disagree: the
 * cooldown was duplicated three times, and the resend button was the piece most
 * worth getting right, because a code that never arrives is the single most
 * common way any of these flows fails.
 *
 * ## The countdown is a promise about the server
 *
 * A fixed 30s guess is only correct while the project's `smtp_max_frequency`
 * happens to be lower (it is 20s — see scripts/auth-config.mjs). When the server
 * refuses because it wants longer, it says how much longer, and `onResend`
 * hands that number back here so the button re-enables when the send will
 * actually be accepted. Otherwise the button invites a tap that is refused, and
 * a refused resend is indistinguishable — to the person waiting — from the code
 * never having been sent.
 */

export const RESEND_COOLDOWN_S = 30;

/** A resend that failed may know when the next one will be allowed. */
export type ResendResult = AuthResult & { retryAfterSeconds?: number | null };

type Props = {
  title: string;
  /** Rendered under the title; the email is the caller's to phrase. */
  subtitle: string;
  /** Verifies the code. Returning `ok` hands control back to the caller, which
   *  is what navigates — where to go next is the one thing the three flows do
   *  not share. */
  onVerify: (code: string) => Promise<AuthResult>;
  onVerified: () => void;
  onResend: () => Promise<ResendResult>;
  /** Label for the confirm button, e.g. "Verify" or "Sign in". */
  verifyLabel: string;
  busyLabel: string;
};

export function EmailCodeStep({
  title,
  subtitle,
  onVerify,
  onVerified,
  onResend,
  verifyLabel,
  busyLabel,
}: Props) {
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();

  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_S);
  const inFlight = useRef(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  // Submits itself on the sixth digit. The code is fixed-length, so there is
  // nothing to decide once it is complete, and every extra tap between "typed
  // the code" and "signed in" is one more place for this to feel broken.
  useEffect(() => {
    if (code.length === OTP_LENGTH && !busy) void verify(code);
    // Only the code should trigger this; `verify` is redefined every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  const verify = async (value: string) => {
    if (value.length !== OTP_LENGTH) {
      setError(t('auth.codeIncomplete'));
      return;
    }
    // A ref rather than the `busy` state: the sixth digit and a tap on the
    // button can land in the same frame, before the re-render that disables it,
    // and a code sent twice is refused the second time — which would put "that
    // code is incorrect" on screen a moment after it worked.
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await onVerify(value);
    inFlight.current = false;
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      // Cleared, because the next attempt is a different code and not an edit
      // of this one — and leaving six wrong digits in place would re-fire the
      // auto-submit above on the next keystroke.
      setCode('');
      return;
    }
    onVerified();
  };

  const handleResend = async () => {
    if (cooldown > 0 || resending) return;
    setResending(true);
    setError(null);
    setNotice(null);
    const result = await onResend();
    setResending(false);
    if (result.ok) {
      setCode('');
      setNotice(t('auth.codeResent'));
      setCooldown(RESEND_COOLDOWN_S);
      return;
    }
    setError(result.error);
    // The server's own number wins when it gave one: it knows when it will
    // accept the next send and this screen does not.
    setCooldown(Math.max(result.retryAfterSeconds ?? 0, RESEND_COOLDOWN_S));
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
          accessibilityLabel={t('common.back')}
          onPress={() => router.back()}
          hitSlop={10}
          className="h-9 w-9 items-center justify-center rounded-full bg-muted"
        >
          <ChevronBack size={20} color={colors[scheme].foreground} />
        </Pressable>

        <View className="gap-2">
          <Text variant="heading">{title}</Text>
          <Text variant="muted">{subtitle}</Text>
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
          {notice && !error && (
            <Text variant="caption" className="text-accent">
              {notice}
            </Text>
          )}

          <Button
            label={busy ? busyLabel : verifyLabel}
            variant="accent"
            size="lg"
            disabled={busy}
            onPress={() => void verify(code)}
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
            disabled={cooldown > 0 || resending || busy}
            onPress={() => void handleResend()}
          />

          {/* The way out of a mistyped address, which is otherwise a dead end:
              the code is going to an inbox the user cannot open, and every
              button on this screen is about a code that will never arrive. */}
          <Pressable
            accessibilityRole="button"
            onPress={() => router.back()}
            hitSlop={8}
            className="items-center py-1"
          >
            <Text variant="caption" className="font-sora-medium">
              {t('auth.wrongEmail')}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
