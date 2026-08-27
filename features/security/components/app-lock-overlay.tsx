import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { LockKeyhole } from '@/components/ui/icons';
import { Text } from '@/components/ui/text';
import { colors } from '@/constants/theme';
import { authenticate, getBiometricLabel } from '@/features/security/lib/biometrics';
import { useAppLockStore } from '@/features/security/store/app-lock-store';
import { useColorScheme } from '@/hooks/use-color-scheme';

/**
 * Full-screen shield shown whenever the app is locked. Auto-prompts the
 * biometric sheet on appearance; if the person cancels, a button lets them try
 * again. Rendered last in the root tree so it covers everything, including the
 * tab bar and any open sheet.
 */
export function AppLockOverlay() {
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const isLocked = useAppLockStore((s) => s.isLocked);
  const unlock = useAppLockStore((s) => s.unlock);
  const [label, setLabel] = useState(() => t('security.biometrics'));
  const [tried, setTried] = useState(false);

  useEffect(() => {
    getBiometricLabel().then(setLabel);
  }, []);

  const tryUnlock = useCallback(async () => {
    const ok = await authenticate(t('security.unlockPrompt'));
    setTried(true);
    if (ok) unlock();
  }, [unlock, t]);

  // Auto-prompt as soon as the shield goes up.
  useEffect(() => {
    if (isLocked) {
      setTried(false);
      tryUnlock();
    }
  }, [isLocked, tryUnlock]);

  if (!isLocked) return null;

  return (
    <View
      className="absolute inset-0 items-center justify-center bg-background px-8"
      style={{ paddingBottom: insets.bottom + 24 }}
    >
      <View className="items-center gap-5">
        <View className="h-20 w-20 items-center justify-center rounded-3xl bg-surface">
          <LockKeyhole size={34} color={colors[scheme].accent} strokeWidth={1.8} />
        </View>
        <View className="items-center gap-1">
          <Text variant="heading">{t('security.locked')}</Text>
          <Text variant="muted" className="text-center">
            {tried ? t('security.authNeeded') : t('security.unlockToContinue', { method: label })}
          </Text>
        </View>
        <Button
          variant="accent"
          size="lg"
          label={t('security.unlockWith', { method: label })}
          onPress={tryUnlock}
          className="mt-2 px-8"
        />
      </View>
    </View>
  );
}
