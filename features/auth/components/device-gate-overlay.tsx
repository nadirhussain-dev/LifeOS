import { formatDistanceToNow } from 'date-fns/formatDistanceToNow';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { cardClass } from '@/components/ui/card';
import { MonitorSmartphone, SmartphoneNfc } from '@/components/ui/icons';
import { Text } from '@/components/ui/text';
import { colors } from '@/constants/theme';
import { OTP_LENGTH, OtpField } from '@/features/auth/components/otp-field';
import {
  completeTakeover,
  requestTakeover,
  useDeviceSession,
} from '@/features/auth/hooks/use-device-session';
import { useAuthStore } from '@/features/auth/services/auth-store';
import { useDeviceSessionStore } from '@/features/auth/store/device-session-store';
import { useColorScheme } from '@/hooks/use-color-scheme';

/**
 * The one-device rule, as the user experiences it.
 *
 * Two screens, and the same overlay serves both because they are two halves of
 * one event seen from two phones:
 *
 *  - **otp_required** — you just signed in here, and the account is open on
 *    another device. A code sent to your own email moves it. This is a hard
 *    gate: until the claim lands, migration 0047's RLS refuses every row, so
 *    letting the app render behind it would show an empty dashboard and read
 *    as data loss.
 *  - **revoked** — you are the other device. The account moved on, this copy
 *    has been wiped, and you are owed a plain sentence saying so rather than
 *    an app that is suddenly empty and signed out with no explanation.
 *
 * An overlay rather than a route, for the same reason `BlockedOverlay` is one:
 * the verdict can change while any screen at all is showing — including
 * mid-scroll, on foreground — and a redirect from wherever the user happens to
 * be loses their place and races the auth gate. Absolute-positioned over
 * everything, it simply appears.
 */
export function DeviceGateOverlay() {
  const scheme = useColorScheme() ?? 'light';
  const theme = colors[scheme];
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  const { verdict, otherDevice, revokedReason } = useDeviceSession();
  const email = useAuthStore((s) => s.profile?.email ?? s.user?.email ?? null);

  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (verdict !== 'otp_required' && verdict !== 'revoked') return null;

  const frame = (children: React.ReactNode) => (
    <View
      className="absolute inset-0 bg-background"
      style={{ paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1"
      >
        <ScrollView
          contentContainerClassName="flex-grow items-center justify-center gap-5 px-8"
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );

  // ---------------------------------------------------------------- revoked
  if (verdict === 'revoked') {
    return frame(
      <View className="w-full items-center gap-5">
        <View className="h-20 w-20 items-center justify-center rounded-3xl bg-surface">
          <MonitorSmartphone size={34} color={theme.mutedForeground} strokeWidth={1.8} />
        </View>
        <View className="items-center gap-2">
          <Text variant="heading" className="text-center">
            {t('device.revokedTitle')}
          </Text>
          <Text variant="muted" className="text-center">
            {revokedReason === 'account_deleted'
              ? t('device.revokedDeleted')
              : otherDevice?.label
                ? t('device.revokedBodyNamed', { device: otherDevice.label })
                : t('device.revokedBody')}
          </Text>
        </View>
        <View className={cardClass({ padding: 'row' }, 'w-full')}>
          <Text variant="sectionLabel">{t('device.wipedTitle')}</Text>
          <Text className="mt-1 text-foreground">{t('device.wipedBody')}</Text>
        </View>
        <Button
          variant="accent"
          size="lg"
          className="w-full"
          label={t('device.revokedDismiss')}
          // Clearing the verdict is all this needs to do: the session is
          // already gone, so the auth gate underneath is showing the way back
          // in the moment this stops covering it.
          onPress={() => useDeviceSessionStore.getState().clear()}
        />
      </View>,
    );
  }

  // ----------------------------------------------------------- otp_required
  const lastSeen = otherDevice?.lastSeenAt
    ? formatDistanceToNow(new Date(otherDevice.lastSeenAt), { addSuffix: true })
    : null;

  const handleSend = async () => {
    if (!email) {
      setError(t('device.noEmail'));
      return;
    }
    setBusy(true);
    setError(null);
    const result = await requestTakeover(email);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSent(true);
  };

  const handleVerify = async () => {
    if (!email) return;
    if (code.length !== OTP_LENGTH) {
      setError(t('auth.codeIncomplete'));
      return;
    }
    setBusy(true);
    setError(null);
    const result = await completeTakeover(email, code);
    setBusy(false);
    if (result.ok) return; // The verdict flips to 'active' and this unmounts.
    setError(
      result.error === 'takeoverProofExpired'
        ? t('device.proofExpired')
        : t('device.codeIncorrect'),
    );
    // A stale proof means starting the code over, not retyping the same one.
    if (result.error === 'takeoverProofExpired') {
      setSent(false);
      setCode('');
    }
  };

  return frame(
    <View className="w-full gap-5">
      <View className="items-center gap-5">
        <View className="h-20 w-20 items-center justify-center rounded-3xl bg-surface">
          <SmartphoneNfc size={34} color={theme.accent} strokeWidth={1.8} />
        </View>
        <View className="items-center gap-2">
          <Text variant="heading" className="text-center">
            {t('device.takeoverTitle')}
          </Text>
          <Text variant="muted" className="text-center">
            {otherDevice?.label
              ? t('device.takeoverBodyNamed', { device: otherDevice.label })
              : t('device.takeoverBody')}
          </Text>
          {lastSeen ? (
            <Text variant="caption" className="text-center">
              {t('device.lastUsed', { ago: lastSeen })}
            </Text>
          ) : null}
        </View>
      </View>

      {/* Said before the code is sent, not after it is verified. This step
          destroys the other device's local copy, and somebody who only wanted
          to check something on a borrowed phone deserves to learn that while
          backing out is still free. */}
      <View className={cardClass({ padding: 'row' }, 'w-full')}>
        <Text variant="sectionLabel">{t('device.whatHappens')}</Text>
        <Text className="mt-1 text-foreground">{t('device.whatHappensBody')}</Text>
      </View>

      {sent ? (
        <View className="w-full gap-4">
          <Text variant="muted" className="text-center">
            {t('auth.codeSentTo', { email })}
          </Text>
          <OtpField
            label={t('auth.verificationCode')}
            value={code}
            onChangeText={setCode}
            autoFocus
          />
          {error ? (
            <Text variant="caption" className="text-destructive">
              {error}
            </Text>
          ) : null}
          <Button
            variant="accent"
            size="lg"
            label={busy ? t('device.movingAccount') : t('device.moveAccount')}
            disabled={busy}
            onPress={() => void handleVerify()}
          />
          <Button
            variant="ghost"
            size="lg"
            label={t('auth.resendCode')}
            disabled={busy}
            onPress={() => void handleSend()}
          />
        </View>
      ) : (
        <View className="w-full gap-2">
          {error ? (
            <Text variant="caption" className="text-destructive">
              {error}
            </Text>
          ) : null}
          <Button
            variant="accent"
            size="lg"
            label={busy ? t('auth.sendingCode') : t('device.sendCode')}
            disabled={busy}
            onPress={() => void handleSend()}
          />
        </View>
      )}

      {/*
        Always reachable. The alternative to continuing here is not "be stuck":
        it is to leave the other device alone and sign out of this one, which is
        exactly what somebody who signed in on a friend's phone wants. Wipes
        this device on the way out like any other sign-out — there is nothing of
        theirs on it yet, since the claim never landed.
      */}
      <Button
        variant="ghost"
        size="lg"
        label={t('device.signOutInstead')}
        disabled={busy}
        onPress={() => void useAuthStore.getState().signOut({ release: false })}
      />
    </View>,
  );
}
