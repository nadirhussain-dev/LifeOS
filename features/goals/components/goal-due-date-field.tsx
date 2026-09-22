import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, View } from 'react-native';

import { formatDate } from '@/lib/date-format';
import { CalendarDays, X } from '@/components/ui/icons';
import { Text } from '@/components/ui/text';
import { colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

type Props = {
  value: number | null;
  onChange: (value: number | null) => void;
};

/** Date-only target-date picker for goals — mirrors the tasks DueDateField's
 * platform handling (iOS compact inline, Android imperative dialog) but drops
 * the time component a goal doesn't need. */
export function GoalDueDateField({ value, onChange }: Props) {
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const [showPicker, setShowPicker] = useState(false);

  const handleChange = (event: DateTimePickerEvent, date?: Date) => {
    if (Platform.OS === 'android') setShowPicker(false);
    if (event.type === 'set' && date) onChange(date.getTime());
  };

  return (
    <View className="flex-row flex-wrap items-center gap-2">
      {Platform.OS === 'ios' ? (
        <DateTimePicker
          value={value ? new Date(value) : new Date()}
          mode="date"
          display="compact"
          onChange={handleChange}
        />
      ) : (
        <Pressable
          accessibilityRole="button"
          onPress={() => setShowPicker(true)}
          className="flex-row items-center gap-1.5 rounded-full border border-border px-3 py-1.5"
        >
          <CalendarDays size={14} color={colors[scheme].mutedForeground} />
          <Text variant="muted">
            {value ? formatDate(value, 'medium') : t('goals.setTargetDate')}
          </Text>
        </Pressable>
      )}

      {value ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => onChange(null)}
          hitSlop={8}
          accessibilityLabel={t('goals.clearDate')}
        >
          <X size={16} color={colors[scheme].mutedForeground} />
        </Pressable>
      ) : null}

      {Platform.OS === 'android' && showPicker ? (
        <DateTimePicker
          value={value ? new Date(value) : new Date()}
          mode="date"
          display="default"
          onChange={handleChange}
        />
      ) : null}
    </View>
  );
}
