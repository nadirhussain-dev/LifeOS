import { eachDayOfInterval, endOfMonth, format, getDay, isToday, startOfMonth } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';

import { cardClass } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { resolveTint } from '@/constants/design-tokens';
import { colors } from '@/constants/theme';
import { MOOD_TINT } from '@/features/journal/constants';
import type { JournalEntry, MoodOption } from '@/features/journal/types/journal.types';
import { toDateKey } from '@/lib/date';

const WEEKDAY_KEYS = [
  'weekdayInitials.sun',
  'weekdayInitials.mon',
  'weekdayInitials.tue',
  'weekdayInitials.wed',
  'weekdayInitials.thu',
  'weekdayInitials.fri',
  'weekdayInitials.sat',
];

type Props = {
  monthAnchor: Date;
  entries: JournalEntry[];
  onSelectDate: (dateKey: string) => void;
};

/** A month-at-a-glance mood grid — the "replay a month of your life" view,
 * distinct from the day-by-day timeline list below it. */
export function MoodMonthStrip({ monthAnchor, entries, onSelectDate }: Props) {
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const moodByDate = new Map(
    entries
      .filter((entry) => entry.mood)
      .map((entry) => [entry.entryDate, entry.mood as MoodOption]),
  );
  const todayKey = toDateKey(new Date());

  const start = startOfMonth(monthAnchor);
  const end = endOfMonth(monthAnchor);
  const days = eachDayOfInterval({ start, end });
  const leadingBlanks = getDay(start);

  return (
    <View className={cardClass({ padding: 'md', elevation: 'e1' }, 'gap-2')}>
      <Text variant="micro" className="font-sora-semibold">
        {format(monthAnchor, 'MMMM')}
      </Text>

      <View className="flex-row">
        {WEEKDAY_KEYS.map((key, index) => (
          <View key={`${key}-${index}`} className="flex-1 items-center">
            <Text variant="caption">{t(key)}</Text>
          </View>
        ))}
      </View>

      <View className="flex-row flex-wrap">
        {Array.from({ length: leadingBlanks }).map((_, index) => (
          <View
            key={`blank-${index}`}
            style={{ width: `${100 / 7}%` }}
            className="aspect-square p-0.5"
          />
        ))}
        {days.map((day) => {
          const dateKey = toDateKey(day);
          const mood = moodByDate.get(dateKey);
          const tint = mood ? resolveTint(MOOD_TINT[mood], scheme) : undefined;
          const today = isToday(day);
          const isFuture = dateKey > todayKey;

          return (
            <View key={dateKey} style={{ width: `${100 / 7}%` }} className="aspect-square p-0.5">
              <Pressable
                accessibilityRole="button"
                onPress={() => onSelectDate(dateKey)}
                disabled={isFuture}
                accessibilityLabel={format(day, 'MMMM d')}
                accessibilityState={{ disabled: isFuture }}
                className="flex-1 items-center justify-center rounded-full"
                style={{
                  backgroundColor: tint ? `${tint}33` : colors[scheme].muted,
                  borderWidth: today ? 1.5 : 0,
                  borderColor: colors[scheme].accent,
                  opacity: isFuture ? 0.35 : 1,
                }}
              >
                <Text
                  variant="caption"
                  className="font-sora-medium"
                  style={{ color: tint ?? colors[scheme].mutedForeground }}
                >
                  {format(day, 'd')}
                </Text>
              </Pressable>
            </View>
          );
        })}
      </View>
    </View>
  );
}
