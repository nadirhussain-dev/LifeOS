import { useTranslation } from 'react-i18next';
import { Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Moon, TimerOff } from '@/components/ui/icons';
import { Text } from '@/components/ui/text';
import { moduleTint } from '@/constants/design-tokens';
import { colors } from '@/constants/theme';
import { formatDuration } from '@/features/music/utils/format-duration';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { alpha } from '@/lib/color';

type Props = {
  visible: boolean;
  onClose: () => void;
  remainingMs: number;
  active: boolean;
  onSelect: (minutes: number | null) => void;
};

const OPTIONS = [15, 30, 45, 60];

/** Sleep-timer picker: auto-pauses playback after the chosen minutes. Enforced
 * in the player controller's status listener so it fires in the background. */
export function SleepTimerSheet({ visible, onClose, remainingMs, active, onSelect }: Props) {
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme() ?? 'light';
  const tint = moduleTint('music', scheme);
  const { t } = useTranslation();

  const pick = (minutes: number | null) => {
    onSelect(minutes);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable
        accessibilityRole="button"
        className="flex-1"
        style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
        onPress={onClose}
      >
        <View className="flex-1 justify-end">
          <Pressable
            accessibilityRole="button"
            onPress={(e) => e.stopPropagation()}
            style={{ paddingBottom: insets.bottom + 12 }}
            className="gap-2 rounded-t-3xl bg-card px-5 pt-3"
          >
            <View
              className="mb-1 h-1 w-10 self-center rounded-full"
              style={{ backgroundColor: colors[scheme].border }}
            />
            <View className="flex-row items-center gap-2 pb-1">
              <Moon size={18} color={tint} />
              <Text variant="subheading">{t('music.sleepTimer')}</Text>
            </View>

            {active && (
              <View
                className="mb-1 flex-row items-center justify-between rounded-2xl px-4 py-3"
                style={{ backgroundColor: alpha(tint, 0.12) }}
              >
                <Text className="font-sora-medium" style={{ color: tint }}>
                  {t('music.pausingIn', { duration: formatDuration(remainingMs) })}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => pick(null)}
                  hitSlop={8}
                  className="flex-row items-center gap-1.5"
                >
                  <TimerOff size={15} color={colors[scheme].mutedForeground} />
                  <Text variant="caption" className="font-sora-semibold">
                    {t('music.turnOff')}
                  </Text>
                </Pressable>
              </View>
            )}

            <View className="flex-row flex-wrap gap-2.5">
              {OPTIONS.map((minutes) => (
                <Pressable
                  accessibilityRole="button"
                  key={minutes}
                  onPress={() => pick(minutes)}
                  className="flex-1 items-center rounded-2xl border border-border py-4"
                  style={{ minWidth: '45%' }}
                >
                  <Text className="font-sora-bold text-lg text-foreground">{minutes}</Text>
                  <Text variant="caption">{t('music.minutes')}</Text>
                </Pressable>
              ))}
            </View>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}
