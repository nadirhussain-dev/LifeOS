import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import { ClipboardPaste } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, TextInput, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { cardClass } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { PinPad } from '@/features/private/components/pin-pad';
import { PrivateScreen } from '@/features/private/components/private-screen';
import { redeemTransfer } from '@/features/private/services/key-transfer';
import { MIN_PIN_LENGTH, adoptVault } from '@/features/private/services/vault-keys';
import { usePrivateStore } from '@/features/private/store/private-store';
import { useTheme } from '@/hooks/use-theme';
import { toast } from '@/lib/toast-store';

/**
 * Receiving a vault from another device.
 *
 * Three steps, in the order that fails cheapest first: paste the payload, enter
 * the code, choose a PIN for *this* device. The PIN is asked for last and is
 * deliberately this device's own — two phones holding the same vault do not
 * share a PIN, and their keystores never hold the same bytes. Only the key
 * underneath is common, which is the whole point.
 */
type Step = 'payload' | 'code' | 'pin';

export default function VaultReceiveScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { c } = useTheme();
  const unlock = usePrivateStore((s) => s.unlock);
  const setSetUpComplete = usePrivateStore((s) => s.setSetUpComplete);

  const [step, setStep] = useState<Step>('payload');
  const [payload, setPayload] = useState('');
  const [code, setCode] = useState('');
  const [pin, setPin] = useState('');
  const [masterKey, setMasterKey] = useState<Uint8Array | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const verify = async () => {
    setBusy(true);
    setError(null);
    const result = await redeemTransfer(payload, code);
    setBusy(false);

    if (!result.ok) {
      // The three reasons are genuinely different problems and get genuinely
      // different messages — "wrong code" sends somebody back to the other
      // phone, "malformed" sends them back to the clipboard.
      setError(
        result.reason === 'unsupported-version'
          ? t('receive.errorVersion')
          : result.reason === 'malformed'
            ? t('receive.errorPayload')
            : t('receive.errorCode'),
      );
      return;
    }
    setMasterKey(result.masterKey);
    setStep('pin');
  };

  const finish = async () => {
    if (!masterKey) return;
    setBusy(true);
    await adoptVault(pin, masterKey);
    setBusy(false);

    // Straight into the space. The rows are probably already here — private
    // modules have always synced as ciphertext — so this is the moment they
    // stop being noise.
    unlock(masterKey, 'real');
    setSetUpComplete(true);
    toast.success(t('receive.done'));
    router.replace('/private');
  };

  return (
    <PrivateScreen
      title={t('receive.title')}
      tint={c.accent}
      footer={
        step === 'payload' ? (
          <Button
            variant="accent"
            size="lg"
            label={t('common.continue')}
            disabled={payload.trim().length === 0}
            onPress={() => {
              setError(null);
              setStep('code');
            }}
          />
        ) : step === 'code' ? (
          <Button
            variant="accent"
            size="lg"
            label={busy ? t('receive.checking') : t('common.continue')}
            disabled={busy || code.trim().length < 8}
            onPress={() => void verify()}
          />
        ) : (
          <Button
            variant="accent"
            size="lg"
            label={busy ? t('common.saving') : t('receive.finish')}
            disabled={busy || pin.length < MIN_PIN_LENGTH}
            onPress={() => void finish()}
          />
        )
      }
    >
      <ScrollView contentContainerClassName="gap-6 pb-6" showsVerticalScrollIndicator={false}>
        <Text variant="muted">{t('receive.intro')}</Text>

        {error ? (
          <Text variant="caption" className="text-destructive">
            {error}
          </Text>
        ) : null}

        {step === 'payload' ? (
          <View className="gap-3">
            <Text variant="micro">{t('receive.stepPayload')}</Text>
            <TextInput
              value={payload}
              onChangeText={setPayload}
              accessibilityLabel={t('receive.stepPayload')}
              placeholder={t('receive.payloadPlaceholder')}
              placeholderTextColor={c.mutedForeground}
              multiline
              autoCapitalize="none"
              autoCorrect={false}
              className={cardClass({ padding: 'none' }, 'px-4 py-3 text-foreground')}
              style={{ minHeight: 110, fontFamily: 'Sora_400Regular', fontSize: 13 }}
            />
            <Pressable
              accessibilityRole="button"
              onPress={() => void Clipboard.getStringAsync().then((text) => setPayload(text ?? ''))}
              className="flex-row items-center justify-center gap-2 rounded-full border py-3"
              style={{ borderColor: c.border }}
            >
              <ClipboardPaste size={15} color={c.foreground} />
              <Text className="font-sora-medium" style={{ color: c.foreground }}>
                {t('receive.paste')}
              </Text>
            </Pressable>
          </View>
        ) : null}

        {step === 'code' ? (
          <View className="gap-3">
            <Text variant="micro">{t('receive.stepCode')}</Text>
            <Text variant="caption">{t('receive.codeHint')}</Text>
            <TextInput
              value={code}
              onChangeText={setCode}
              accessibilityLabel={t('receive.stepCode')}
              placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
              placeholderTextColor={c.mutedForeground}
              autoCapitalize="characters"
              autoCorrect={false}
              autoFocus
              className={cardClass({ padding: 'none' }, 'px-4 py-4 text-foreground')}
              style={{ fontFamily: 'Sora_500Medium', fontSize: 17, letterSpacing: 1.5 }}
            />
          </View>
        ) : null}

        {step === 'pin' ? (
          <View className="items-center gap-6">
            <View className="gap-1">
              <Text variant="micro" className="text-center">
                {t('receive.stepPin')}
              </Text>
              <Text variant="caption" className="text-center">
                {t('receive.pinHint')}
              </Text>
            </View>
            <PinPad value={pin} onChange={setPin} disabled={busy} dotCount={MIN_PIN_LENGTH} />
          </View>
        ) : null}
      </ScrollView>
    </PrivateScreen>
  );
}
