import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { type LucideIcon } from 'lucide-react-native';
import { useState } from 'react';
import { Platform, Pressable, View } from 'react-native';

import { cardClass } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { formatClock, minutesOfDay } from '@/features/sleep/services/sleep-stats';

type Props = {
  icon: LucideIcon;
  label: string;
  /** Time-of-day carrier; only hours/minutes are read. */
  value: Date;
  onChange: (value: Date) => void;
  tint: string;
};

/** Labelled time-of-day picker. iOS shows the native compact field inline;
 * Android opens the clock dialog on tap. */
export function TimeField({ icon: Icon, label, value, onChange, tint }: Props) {
  const [show, setShow] = useState(false);

  const handleChange = (event: DateTimePickerEvent, date?: Date) => {
    if (Platform.OS === 'android') setShow(false);
    if (event.type === 'set' && date) onChange(date);
  };

  return (
    <View className={cardClass({ padding: 'md' }, 'flex-1 items-center gap-2')}>
      <View
        className="h-10 w-10 items-center justify-center rounded-xl"
        style={{ backgroundColor: `${tint}1f` }}
      >
        <Icon size={18} color={tint} />
      </View>
      <Text variant="micro">{label}</Text>
      {Platform.OS === 'ios' ? (
        <DateTimePicker value={value} mode="time" display="compact" onChange={handleChange} />
      ) : (
        <Pressable
          accessibilityRole="button"
          onPress={() => setShow(true)}
          className="rounded-lg border border-border bg-surface px-3 py-1.5"
        >
          <Text className="font-sora-semibold text-foreground">
            {formatClock(minutesOfDay(value.getTime()))}
          </Text>
        </Pressable>
      )}
      {Platform.OS === 'android' && show && (
        <DateTimePicker value={value} mode="time" display="default" onChange={handleChange} />
      )}
    </View>
  );
}
