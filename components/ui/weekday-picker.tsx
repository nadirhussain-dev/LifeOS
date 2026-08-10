import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { useTheme } from '@/hooks/use-theme';

/** 0 = Sunday, matching `Date#getDay`, `Habit.scheduleDays` and the weekday
 *  argument of `scheduleWeeklyNotification`. One convention, everywhere. */
const WEEKDAY_KEYS = [
  'weekdayInitials.sun',
  'weekdayInitials.mon',
  'weekdayInitials.tue',
  'weekdayInitials.wed',
  'weekdayInitials.thu',
  'weekdayInitials.fri',
  'weekdayInitials.sat',
] as const;

type Props = {
  /** Selected weekdays, 0-based with Sunday = 0. */
  value: number[];
  onChange: (days: number[]) => void;
  /** Overrides the accent, so a module's own tint can be used. */
  tint?: string;
};

/**
 * A row of seven day toggles.
 *
 * Extracted because a second caller appeared (the study reminder) and the first
 * one — `features/habits/components/schedule-picker.tsx` — had the day initials
 * hardcoded as `'S','M','T','W','T','F','S'`. A `weekdayInitials` namespace with
 * all four languages in it already existed and was being used by exactly one
 * component, so the app has been shipping English day initials inside its Arabic
 * and Urdu layouts.
 *
 * The order is not reversed for RTL: `flex-row` already flips under
 * `I18nManager`, so reversing here would flip it back and put Sunday on the
 * wrong end.
 */
export function WeekdayPicker({ value, onChange, tint }: Props) {
  const { t } = useTranslation();
  const { c } = useTheme();
  const accent = tint ?? c.accent;
  const selected = new Set(value);

  const toggle = (day: number) => {
    Haptics.selectionAsync();
    const next = new Set(selected);
    if (next.has(day)) next.delete(day);
    else next.add(day);
    onChange([...next].sort((a, b) => a - b));
  };

  return (
    <View className="flex-row gap-2">
      {WEEKDAY_KEYS.map((key, day) => {
        const isSelected = selected.has(day);
        return (
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: isSelected }}
            // The initial alone is meaningless to a screen reader, and in
            // English two pairs of days share one. `date-fns` is not needed for
            // this — i18next already has the full names under `weekdays`.
            accessibilityLabel={t(`weekdays.${key.split('.')[1]}`, {
              defaultValue: t(key),
            })}
            key={key}
            onPress={() => toggle(day)}
            className="h-9 w-9 items-center justify-center rounded-full border"
            style={{
              borderColor: isSelected ? accent : c.border,
              backgroundColor: isSelected ? accent : 'transparent',
            }}
          >
            <Text
              variant="caption"
              className="font-sora-semibold"
              style={{ color: isSelected ? c.accentForeground : c.mutedForeground }}
            >
              {t(key)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
