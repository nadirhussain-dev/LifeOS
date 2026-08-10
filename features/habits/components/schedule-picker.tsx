import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { Pressable, TextInput, View } from 'react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';

import { Text } from '@/components/ui/text';
import { WeekdayPicker } from '@/components/ui/weekday-picker';
import { colors } from '@/constants/theme';
import type { HabitScheduleType } from '@/features/habits/types/habit.types';

const SCHEDULE_OPTIONS: { value: HabitScheduleType; labelKey: string }[] = [
  { value: 'daily', labelKey: 'schedule.everyDay' },
  { value: 'weekly', labelKey: 'schedule.weekly' },
  { value: 'monthly', labelKey: 'schedule.monthly' },
  { value: 'custom_days', labelKey: 'schedule.certainDays' },
  { value: 'every_x_days', labelKey: 'schedule.everyXDays' },
  { value: 'flexible', labelKey: 'schedule.flexible' },
];

type Props = {
  scheduleType: HabitScheduleType;
  scheduleDays: number[] | null;
  scheduleIntervalDays: number | null;
  onChangeType: (value: HabitScheduleType) => void;
  onChangeDays: (value: number[]) => void;
  onChangeInterval: (value: number | null) => void;
};

export function SchedulePicker({
  scheduleType,
  scheduleDays,
  scheduleIntervalDays,
  onChangeType,
  onChangeDays,
  onChangeInterval,
}: Props) {
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();

  return (
    <View className="gap-3">
      <View className="flex-row flex-wrap gap-2">
        {SCHEDULE_OPTIONS.map((option) => {
          const selected = option.value === scheduleType;
          return (
            <Pressable
              accessibilityRole="button"
              key={option.value}
              onPress={() => {
                Haptics.selectionAsync();
                onChangeType(option.value);
              }}
              className="rounded-full border px-3 py-1.5"
              style={{
                borderColor: selected ? colors[scheme].accent : colors[scheme].border,
                backgroundColor: selected ? colors[scheme].accent : 'transparent',
              }}
            >
              <Text
                variant="caption"
                className="font-sora-medium"
                style={{
                  color: selected
                    ? colors[scheme].accentForeground
                    : colors[scheme].mutedForeground,
                }}
              >
                {t(option.labelKey)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {scheduleType === 'custom_days' && (
        <WeekdayPicker value={scheduleDays ?? []} onChange={onChangeDays} />
      )}

      {scheduleType === 'every_x_days' && (
        <View className="flex-row items-center gap-2">
          <Text variant="muted">{t('schedule.repeatEvery')}</Text>
          <TextInput
            accessibilityLabel={t('schedule.repeatIntervalDays')}
            value={scheduleIntervalDays ? String(scheduleIntervalDays) : ''}
            onChangeText={(text) => {
              const parsed = parseInt(text, 10);
              onChangeInterval(Number.isFinite(parsed) && parsed > 0 ? parsed : null);
            }}
            keyboardType="number-pad"
            placeholder="3"
            placeholderTextColor={colors[scheme].mutedForeground}
            className="w-14 rounded-lg border border-border px-2 py-1.5 text-center text-foreground"
          />
          <Text variant="muted">{t('schedule.days')}</Text>
        </View>
      )}
    </View>
  );
}
