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
  /** `yyyy-MM-dd`, matching every other date in cycle-math.ts/cycle.ts — never
   *  epoch ms, since a Cycle entry always has a date (unlike a goal's
   *  optional due date, which this is adapted from). */
  value: string;
  onChange: (value: string) => void;
};

/** Date-only field for a Cycle entry — same iOS-compact / Android-imperative
 * split as GoalDueDateField (goals/components/goal-due-date-field.tsx), but
 * always has a value (no clear button) and never allows a future date: a
 * cycle entry describes something that already happened. */
export function CycleDateField({ value, onChange }: Props) {
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
        <DateTimePicker
          value={date}
          mode="date"
          display="compact"
          maximumDate={new Date()}
          onChange={handleChange}
        />
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
            <DateTimePicker
              value={date}
              mode="date"
              display="default"
              maximumDate={new Date()}
              onChange={handleChange}
            />
          ) : null}
        </>
      )}
    </View>
  );
}
