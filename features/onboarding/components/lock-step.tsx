import { ShieldCheck } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { StepScaffold } from '@/features/onboarding/components/step-scaffold';
import { useTheme } from '@/hooks/use-theme';
import { alpha } from '@/lib/color';

/**
 * The app-lock offer.
 *
 * Framed as a question with two real answers rather than a nag. It is genuinely
 * optional, it is reversible from Settings, and the copy says both — an app that
 * pressures somebody into a security setting during setup gets it switched off a
 * week later by someone who now distrusts the rest of the settings screen too.
 *
 * When the device has no biometrics enrolled there is nothing to offer, so it
 * says so and moves on rather than showing a button that opens a system dialog
 * the user cannot satisfy.
 */
export function LockStep({
  available,
  methodLabel,
  onEnable,
  onSkip,
}: {
  available: boolean;
  methodLabel: string;
  onEnable: () => void;
  onSkip: () => void;
}) {
  const { t } = useTranslation();
  const { c } = useTheme();

  return (
    <StepScaffold
      hero
      title={t('onboarding.keepPrivate')}
      body={
        available ? t('onboarding.lockBody', { method: methodLabel }) : t('onboarding.noBiometrics')
      }
      above={
        <View
          className="h-[76px] w-[76px] items-center justify-center rounded-[26px]"
          style={{ backgroundColor: alpha(c.accent, 0.12) }}
        >
          <ShieldCheck size={36} color={c.accent} strokeWidth={1.8} />
        </View>
      }
      footer={
        available ? (
          <>
            <Button
              variant="accent"
              size="lg"
              label={t('onboarding.enableMethod', { method: methodLabel })}
              onPress={onEnable}
            />
            <Button variant="ghost" size="lg" label={t('onboarding.notNow')} onPress={onSkip} />
          </>
        ) : (
          <Button variant="accent" size="lg" label={t('common.continue')} onPress={onSkip} />
        )
      }
    />
  );
}
