import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { format } from 'date-fns/format';
import { parseISO } from 'date-fns/parseISO';
import { useState } from 'react';
import { Platform, Pressable, View } from 'react-native';

import { formatDate } from '@/lib/date-format';
import { CalendarDays } from '@/components/ui/icons';
import { Text } from '@/components/ui/text';
import { colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

type Props = {
  /** `yyyy-MM-dd`. */
  value: string;
  onChange: (value: string) => void;
};

/**
 * Date-only field for a shared plan or milestone — same iOS-compact/
 * Android-imperative split as CycleDateField/GoalDueDateField, but with NO
 * `maximumDate`: unlike a Cycle entry (always describes something already
 * logged) a plan is usually for a date that hasn't happened yet, and a
 * milestone can be either. Kept as its own small component rather than
 * reusing CycleDateField for exactly that constraint mismatch.
 */
export function AlbumDateField({ value, onChange }: Props) {
  const scheme = useColorScheme() ?? 'light';
  const [showPicker, setShowPicker] = useState(false);
  const date = value ? parseISO(value) : new Date();

  const handleChange = (event: DateTimePickerEvent, next?: Date) => {
    if (Platform.OS === 'android') setShowPicker(false);
    if (event.type === 'set' && next) onChange(format(next, 'yyyy-MM-dd'));
  };

  return (
    <View className="flex-row items-center gap-2">
      {Platform.OS === 'ios' ? (
        <DateTimePicker value={date} mode="date" display="compact" onChange={handleChange} />
      ) : (
        <>
          <Pressable
            accessibilityRole="button"
            onPress={() => setShowPicker(true)}
            className="flex-row items-center gap-1.5 rounded-full border border-border px-3 py-1.5"
          >
            <CalendarDays size={14} color={colors[scheme].mutedForeground} />
            <Text variant="muted">{formatDate(date, 'medium')}</Text>
          </Pressable>
          {showPicker ? (
            <DateTimePicker value={date} mode="date" display="default" onChange={handleChange} />
          ) : null}
        </>
      )}
    </View>
  );
}
