import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { Ban, Clock, Gauge, Hash, MapPin, ToggleLeft } from '@/components/ui/icons';
import { useColorScheme } from '@/hooks/use-color-scheme';

import { Text } from '@/components/ui/text';
import { colors } from '@/constants/theme';
import type { HabitType } from '@/features/habits/types/habit.types';

const OPTIONS: { value: HabitType; labelKey: string; icon: typeof Hash }[] = [
  { value: 'boolean', labelKey: 'habitType.boolean', icon: ToggleLeft },
  { value: 'count', labelKey: 'habitType.count', icon: Hash },
  { value: 'duration', labelKey: 'habitType.duration', icon: Clock },
  { value: 'distance', labelKey: 'habitType.distance', icon: MapPin },
  { value: 'time', labelKey: 'habitType.time', icon: Gauge },
  { value: 'negative', labelKey: 'habitType.avoid', icon: Ban },
];

export function HabitTypePicker({
  value,
  onChange,
}: {
  value: HabitType;
  onChange: (value: HabitType) => void;
}) {
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();

  return (
    <View className="flex-row flex-wrap gap-2">
      {OPTIONS.map((option) => {
        const selected = option.value === value;
        const Icon = option.icon;
        return (
          <Pressable
            accessibilityRole="button"
            key={option.value}
            onPress={() => {
              Haptics.selectionAsync();
              onChange(option.value);
            }}
            className="flex-row items-center gap-1.5 rounded-full border px-3 py-2"
            style={{
              borderColor: selected ? colors[scheme].accent : colors[scheme].border,
              backgroundColor: selected ? colors[scheme].accent : 'transparent',
            }}
          >
            <Icon
              size={14}
              color={selected ? colors[scheme].accentForeground : colors[scheme].mutedForeground}
            />
            <Text
              variant="caption"
              className="font-sora-medium"
              style={{
                color: selected ? colors[scheme].accentForeground : colors[scheme].mutedForeground,
              }}
            >
              {t(option.labelKey)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
