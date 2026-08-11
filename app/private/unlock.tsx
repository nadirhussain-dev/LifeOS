import { useRouter } from 'expo-router';
import { KeyRound } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { colors } from '@/constants/theme';
import { PinPad } from '@/features/private/components/pin-pad';
import { VaultSealTransition } from '@/features/private/components/vault-seal-transition';
import { useVaultTransition } from '@/features/private/hooks/use-vault-transition';
import { MIN_PIN_LENGTH, isVaultSetUp, unlockVault } from '@/features/private/services/vault-keys';
import { usePrivateStore } from '@/features/private/store/private-store';
import { useColorScheme } from '@/hooks/use-color-scheme';

/**
 * The door.
 *
 * Two things it deliberately does not do. It never says "wrong PIN, but this
 * one would have opened the decoy" — the two spaces are indistinguishable from
 * here, which is the only way a decoy is worth having. And it never offers a
 * recovery link: there is no recovery, because a way to reset the PIN without
 * the PIN is a way in.
 */
export default function PrivateUnlockScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();

  const unlock = usePrivateStore((s) => s.unlock);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryInMs, setRetryInMs] = useState(0);
  const transition = useVaultTransition();

  useEffect(() => {
    void isVaultSetUp().then((ready) => {
      if (!ready) router.replace('/private/setup');
    });
  }, [router]);

  const submit = useCallback(async () => {
    if (pin.length < MIN_PIN_LENGTH || busy) return;
    setBusy(true);
    setError(null);

    const result = await transition.run('opening', () => unlockVault(pin));
    setBusy(false);
    setPin('');

    if (result.ok) {
      unlock(result.key, result.space);
      router.replace('/private');
      return;
    }

    if (result.reason === 'throttled') {
      setRetryInMs(result.retryInMs ?? 0);
      setError(t('private.throttled', { minutes: Math.ceil((result.retryInMs ?? 0) / 60000) }));
      return;
    }
    if (result.reason === 'not-set-up') {
      router.replace('/private/setup');
      return;
    }
    setError(t('private.wrongPin'));
  }, [pin, busy, unlock, router, t, transition]);

  // Counts the throttle down so the button re-enables on its own rather than
  // leaving somebody tapping a dead screen.
  useEffect(() => {
    if (retryInMs <= 0) return;
    const timer = setInterval(() => {
      setRetryInMs((ms) => {
        const next = ms - 1000;
        if (next <= 0) {
          setError(null);
          return 0;
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [retryInMs]);

  const blocked = busy || retryInMs > 0;

  return (
    <View
      className="flex-1 bg-background px-6"
      style={{ paddingTop: insets.top + 24, paddingBottom: insets.bottom + 16 }}
    >
      <View className="flex-1 items-center justify-center gap-7">
        <View className="h-20 w-20 items-center justify-center rounded-3xl bg-surface">
          <KeyRound size={34} color={colors[scheme].accent} strokeWidth={1.8} />
        </View>

        <View className="items-center gap-2">
          <Text variant="heading">{t('private.unlockTitle')}</Text>
          <Text variant="muted" className="text-center">
            {error ?? t('private.unlockBody')}
          </Text>
        </View>

        <PinPad value={pin} onChange={setPin} disabled={blocked} dotCount={MIN_PIN_LENGTH} />
      </View>

      <View className="gap-2">
        <Button
          variant="accent"
          size="lg"
          label={busy ? t('private.unlocking') : t('private.unlock')}
          disabled={pin.length < MIN_PIN_LENGTH || blocked}
          onPress={() => void submit()}
        />
        <Button
          variant="ghost"
          size="lg"
          label={t('common.cancel')}
          onPress={() => router.back()}
        />
      </View>

      <VaultSealTransition visible={transition.visible} mode={transition.mode} />
    </View>
  );
}
