import { addDays } from 'date-fns/addDays';
import { addHours } from 'date-fns/addHours';
import { format } from 'date-fns/format';
import { set } from 'date-fns/set';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';

import { Text } from '@/components/ui/text';
import { colors } from '@/constants/theme';
import { shiftTimestampOutOfQuietHours } from '@/features/notifications/services/quiet-hours';
import { useNotificationsStore } from '@/features/notifications/store/notifications-store';
import {
  CATEGORY_META,
  type NotificationCategory,
} from '@/features/notifications/types/notification.types';

type Props = {
  value: number | null;
  onChange: (value: number | null) => void;
  /** Which category the reminder will be scheduled under, so the picker can say
   *  whether quiet hours are going to move it. Notes are the only caller today. */
  category?: NotificationCategory;
};

const QUICK_PICKS = [
  { labelKey: 'reminder.in1Hour', getDate: () => addHours(new Date(), 1).getTime() },
  {
    labelKey: 'reminder.thisEvening',
    getDate: () =>
      set(new Date(), { hours: 18, minutes: 0, seconds: 0, milliseconds: 0 }).getTime(),
  },
  {
    labelKey: 'reminder.tomorrow9am',
    getDate: () =>
      set(addDays(new Date(), 1), { hours: 9, minutes: 0, seconds: 0, milliseconds: 0 }).getTime(),
  },
  {
    labelKey: 'reminder.nextWeek',
    getDate: () =>
      set(addDays(new Date(), 7), { hours: 9, minutes: 0, seconds: 0, milliseconds: 0 }).getTime(),
  },
] as const;

/** Quick-pick reminder chips rather than a raw date/time picker — covers the
 * common "remind me later" cases without the cross-platform hassle of
 * @react-native-community/datetimepicker's mode="datetime" (iOS-only; Android
 * needs a separate date then time dialog). */
export function ReminderPicker({ value, onChange, category = 'notes' }: Props) {
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();

  // Subscribed rather than read once, so the line below re-evaluates if quiet
  // hours are changed while this screen is open.
  const quietEnabled = useNotificationsStore((s) => s.quietHoursEnabled);
  const quietStart = useNotificationsStore((s) => s.quietStartMinutes);
  const quietEnd = useNotificationsStore((s) => s.quietEndMinutes);

  /**
   * When quiet hours will move this reminder, and where to.
   *
   * Picking 11pm and being reminded at 7am is the correct behaviour — a note
   * saying "take a look at this" is not worth waking someone for — but it is
   * indefensible to do it silently. The picker shows a time; the user has every
   * reason to believe that is when it will fire.
   *
   * Mirrors the same two conditions `scheduleOneTimeNotification` applies, so
   * what this predicts is what actually happens.
   */
  const shiftedTo = useMemo(() => {
    if (value === null) return null;
    if (CATEGORY_META[category].bypassQuietHours) return null;
    const shifted = shiftTimestampOutOfQuietHours(value);
    return shifted === value ? null : shifted;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, category, quietEnabled, quietStart, quietEnd]);

  return (
    <View className="gap-2">
      {value !== null && (
        <View className="flex-row items-center justify-between">
          <Text variant="muted">{format(value, "EEE, MMM d 'at' h:mm a")}</Text>
          <Pressable accessibilityRole="button" onPress={() => onChange(null)} hitSlop={8}>
            <Text
              variant="caption"
              className="font-sora-medium"
              style={{ color: colors[scheme].destructive }}
            >
              {t('common.clear')}
            </Text>
          </Pressable>
        </View>
      )}
      <View className="flex-row flex-wrap gap-2">
        {QUICK_PICKS.map((option) => (
          <Pressable
            accessibilityRole="button"
            key={option.labelKey}
            onPress={() => onChange(option.getDate())}
            className="rounded-full border border-border px-3 py-1.5"
          >
            <Text variant="caption" className="font-sora-medium">
              {t(option.labelKey)}
            </Text>
          </Pressable>
        ))}
      </View>
      {shiftedTo !== null && (
        <Text variant="caption">
          {t('reminder.quietHoursShift', { time: format(shiftedTo, 'h:mm a') })}
        </Text>
      )}
    </View>
  );
}
