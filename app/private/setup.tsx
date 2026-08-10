import { useRouter } from 'expo-router';
import { ShieldCheck, TriangleAlert } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { resolveTint } from '@/constants/design-tokens';
import { colors } from '@/constants/theme';
import { PinPad } from '@/features/private/components/pin-pad';
import {
  PRIVATE_MODULES,
  suggestedFor,
  type PrivateModuleId,
} from '@/features/private/config/private-modules';
import { isEscrowConfigured, uploadEscrow } from '@/features/private/services/vault-escrow';
import { MIN_PIN_LENGTH, setUpVault } from '@/features/private/services/vault-keys';
import { usePrivateStore } from '@/features/private/store/private-store';
import { useProfileStore } from '@/features/profile/store/profile-store';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { alpha } from '@/lib/color';

/**
 * First run of the private space: choose what goes in it, choose a PIN, and be
 * told plainly that a forgotten PIN means the data is gone.
 *
 * The warning is not boilerplate. This is the one place in LifeOS where losing
 * a credential destroys data with no recovery path, and burying that would be
 * the single worst thing this feature could do to somebody.
 */
type Step = 'modules' | 'pin' | 'confirm';

export default function PrivateSetupScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme() ?? 'light';
  const theme = colors[scheme];
  const { t } = useTranslation();

  const gender = useProfileStore((s) => s.gender);
  const unlock = usePrivateStore((s) => s.unlock);
  const setEnabledModules = usePrivateStore((s) => s.setEnabledModules);
  const setSetUpComplete = usePrivateStore((s) => s.setSetUpComplete);

  const [step, setStep] = useState<Step>('modules');
  const [chosen, setChosen] = useState<PrivateModuleId[]>(() => suggestedFor(gender));
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (id: PrivateModuleId) =>
    setChosen((prev) => (prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]));

  const finish = async () => {
    if (pin !== confirmPin) {
      setError(t('private.pinMismatch'));
      setConfirmPin('');
      return;
    }
    setBusy(true);
    const key = await setUpVault(pin);
    // Seals a copy of the master key to the operator. No-ops when the build
    // has no escrow key configured, in which case the vault stays E2E.
    await uploadEscrow(key);
    setEnabledModules(chosen);
    setSetUpComplete(true);
    unlock(key, 'real');
    setBusy(false);
    router.replace('/private');
  };

  return (
    <View
      className="flex-1 bg-background px-6"
      style={{ paddingTop: insets.top + 20, paddingBottom: insets.bottom + 16 }}
    >
      {step === 'modules' ? (
        <>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerClassName="gap-6 pb-6">
            <View className="gap-3">
              <View className="h-16 w-16 items-center justify-center rounded-2xl bg-surface">
                <ShieldCheck size={30} color={theme.accent} strokeWidth={1.8} />
              </View>
              <Text variant="heading">{t('private.setupTitle')}</Text>
              <Text variant="muted">{t('private.setupBody')}</Text>
            </View>

            <View className="gap-2.5">
              {PRIVATE_MODULES.map((module) => {
                const selected = chosen.includes(module.id);
                const Icon = module.icon;
                const tint = resolveTint(module.tint, scheme);
                return (
                  <Pressable
                    key={module.id}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: selected }}
                    onPress={() => toggle(module.id)}
                    className="flex-row items-center gap-3 rounded-2xl border px-4 py-3.5"
                    style={{
                      borderColor: selected ? tint : theme.border,
                      backgroundColor: selected ? alpha(tint, 0.1) : 'transparent',
                    }}
                  >
                    <View
                      className="h-10 w-10 items-center justify-center rounded-xl"
                      style={{ backgroundColor: alpha(tint, 0.16) }}
                    >
                      <Icon size={20} color={tint} strokeWidth={1.9} />
                    </View>
                    <View className="flex-1">
                      <Text className="font-sora-medium text-foreground">{t(module.titleKey)}</Text>
                      <Text variant="caption">{t(module.subtitleKey)}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>

            {/* Says out loud that the list is not decided by the gender answer. */}
            <Text variant="caption" className="px-1">
              {t('private.suggestionNote')}
            </Text>

            {/*
              Disclosed here, before a single item is added and before a PIN is
              chosen — not buried in a policy nobody opens. Somebody deciding
              whether to put intimate photos or cycle data in this app is
              entitled to know who can reach it while the decision is still in
              front of them.

              Rendered only when the build actually has escrow configured, so a
              fork without an operator key does not display a warning that is
              false for it.
            */}
            {isEscrowConfigured() ? (
              <View
                className="flex-row items-start gap-2.5 rounded-2xl border px-4 py-3"
                style={{ borderColor: alpha(theme.destructive, 0.4) }}
              >
                <TriangleAlert size={18} color={theme.destructive} strokeWidth={2} />
                <Text variant="caption" className="flex-1">
                  {t('private.operatorNotice')}
                </Text>
              </View>
            ) : null}
          </ScrollView>

          <Button
            variant="accent"
            size="lg"
            label={t('common.continue')}
            disabled={chosen.length === 0}
            onPress={() => setStep('pin')}
          />
          {/*
            Offered here because this is where somebody who already has a vault
            elsewhere will arrive, and creating a second one is the mistake that
            cannot be undone: a fresh master key leaves every already-synced
            private row permanently unreadable, while looking like it worked.
          */}
          <Button
            variant="ghost"
            size="lg"
            label={t('receive.entry')}
            onPress={() => router.push('/private/receive')}
          />
        </>
      ) : null}

      {step === 'pin' || step === 'confirm' ? (
        <>
          <View className="flex-1 items-center justify-center gap-7">
            <View className="items-center gap-2">
              <Text variant="heading">
                {step === 'pin' ? t('private.choosePin') : t('private.confirmPin')}
              </Text>
              <Text variant="muted" className="text-center">
                {error ??
                  (step === 'pin'
                    ? t('private.pinHint', { count: MIN_PIN_LENGTH })
                    : t('private.confirmPinHint'))}
              </Text>
            </View>

            <PinPad
              value={step === 'pin' ? pin : confirmPin}
              onChange={(next) => {
                setError(null);
                if (step === 'pin') setPin(next);
                else setConfirmPin(next);
              }}
              disabled={busy}
              dotCount={MIN_PIN_LENGTH}
            />

            {step === 'pin' ? (
              <View
                className="flex-row items-start gap-2.5 rounded-2xl border px-4 py-3"
                style={{ borderColor: alpha(theme.destructive, 0.4) }}
              >
                <TriangleAlert size={18} color={theme.destructive} strokeWidth={2} />
                <Text variant="caption" className="flex-1">
                  {t('private.noRecoveryWarning')}
                </Text>
              </View>
            ) : null}
          </View>

          <View className="gap-2">
            <Button
              variant="accent"
              size="lg"
              label={step === 'pin' ? t('common.continue') : t('private.createSpace')}
              disabled={
                busy ||
                (step === 'pin' ? pin.length < MIN_PIN_LENGTH : confirmPin.length < MIN_PIN_LENGTH)
              }
              onPress={() => {
                if (step === 'pin') setStep('confirm');
                else void finish();
              }}
            />
            <Button
              variant="ghost"
              size="lg"
              label={t('common.back')}
              disabled={busy}
              onPress={() => {
                setError(null);
                if (step === 'confirm') {
                  setConfirmPin('');
                  setStep('pin');
                } else {
                  setPin('');
                  setStep('modules');
                }
              }}
            />
          </View>
        </>
      ) : null}
    </View>
  );
}
