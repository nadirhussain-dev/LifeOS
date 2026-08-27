import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, View } from 'react-native';

import { Delete } from '@/components/ui/icons';
import { Text } from '@/components/ui/text';
import { colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

/**
 * The private space's keypad.
 *
 * Its own component rather than a TextInput, for two reasons that both matter
 * here: a numeric keypad cannot be intercepted by a third-party keyboard (which
 * on Android can be a keylogger with the user's blessing), and there is no text
 * field for the OS to offer to autofill, remember, or sync to another device.
 *
 * The filled-dot row shows length only. No "last digit visible" reveal — the
 * threat model for this screen includes somebody standing behind you.
 */
type Props = {
  value: string;
  onChange: (next: string) => void;
  maxLength?: number;
  disabled?: boolean;
  /** Dots to draw. Above this the row switches to a count, so a long
   * passphrase does not overflow the screen. */
  dotCount: number;
};

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'delete'] as const;

export function PinPad({ value, onChange, maxLength = 32, disabled = false, dotCount }: Props) {
  const scheme = useColorScheme() ?? 'light';
  const theme = colors[scheme];
  const { t } = useTranslation();

  const press = (key: string) => {
    if (disabled) return;
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    if (key === 'delete') onChange(value.slice(0, -1));
    else if (value.length < maxLength) onChange(value + key);
  };

  const dots = Math.min(dotCount, 12);

  return (
    <View className="items-center gap-8">
      <View className="h-6 flex-row items-center gap-3">
        {value.length > 12 ? (
          <Text variant="muted">{t('private.digitsEntered', { count: value.length })}</Text>
        ) : (
          Array.from({ length: Math.max(dots, value.length) }).map((_, index) => (
            <View
              key={index}
              className="h-3 w-3 rounded-full"
              style={{
                backgroundColor: index < value.length ? theme.accent : 'transparent',
                borderWidth: index < value.length ? 0 : 1.5,
                borderColor: theme.border,
              }}
            />
          ))
        )}
      </View>

      <View className="w-full max-w-[280px] flex-row flex-wrap justify-between gap-y-3">
        {KEYS.map((key, index) =>
          key === '' ? (
            <View key={`spacer-${index}`} className="h-[72px] w-[30%]" />
          ) : (
            <Pressable
              key={key}
              accessibilityRole="button"
              accessibilityLabel={key === 'delete' ? t('common.delete') : key}
              onPress={() => press(key)}
              disabled={disabled}
              className="h-[72px] w-[30%] items-center justify-center rounded-2xl"
              style={({ pressed }) => ({
                backgroundColor: pressed ? theme.muted : 'transparent',
                opacity: disabled ? 0.4 : 1,
              })}
            >
              {key === 'delete' ? (
                <Delete size={24} color={theme.foreground} strokeWidth={1.8} />
              ) : (
                <Text className="font-sora-medium text-2xl text-foreground">{key}</Text>
              )}
            </Pressable>
          ),
        )}
      </View>
    </View>
  );
}
