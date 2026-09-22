import { eachDayOfInterval } from 'date-fns/eachDayOfInterval';
import { endOfMonth } from 'date-fns/endOfMonth';
import { format } from 'date-fns/format';
import { getDay } from 'date-fns/getDay';
import { isToday } from 'date-fns/isToday';
import { startOfMonth } from 'date-fns/startOfMonth';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { formatDate, formatDayOfMonth } from '@/lib/date-format';
import { ChevronBack, ChevronForward } from '@/components/ui/directional-icon';
import { cardClass } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { colors } from '@/constants/theme';
import type { CycleEntry, Flow } from '@/features/private/services/cycle-math';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { alpha } from '@/lib/color';

const WEEKDAY_KEYS = [
  'weekdayInitials.sun',
  'weekdayInitials.mon',
  'weekdayInitials.tue',
  'weekdayInitials.wed',
  'weekdayInitials.thu',
  'weekdayInitials.fri',
  'weekdayInitials.sat',
];

/** Darker for a heavier flow — a day marked "heavy" should read differently
 *  from one marked "spotting" at a glance, the same way the mood strip tints
 *  by mood value rather than using one flat "has an entry" color. */
const FLOW_ALPHA: Record<Flow, number> = {
  spotting: 0.16,
  light: 0.32,
  medium: 0.55,
  heavy: 0.8,
};

/** A day logged with symptoms/mood/note but no flow — distinct from both "no
 *  entry" (plain muted background) and a flow day (intensity-tinted). */
const LOGGED_NO_FLOW_ALPHA = 0.12;

type Props = {
  monthAnchor: Date;
  entries: CycleEntry[];
  tint: string;
  onSelectDate: (dateKey: string) => void;
  onPrevMonth: () => void;
  onNextMonth: () => void;
};

/** A month-at-a-glance grid, adapted from journal's MoodMonthStrip — marks
 * which days have a Cycle entry and, when one was logged, how heavy the flow
 * was. Tapping a day opens CycleEntrySheet: an existing entry for that date
 * in edit mode, or a blank one pre-filled with that date otherwise — this is
 * the only way to log or edit a day other than today. */
export function CycleMonthStrip({
  monthAnchor,
  entries,
  tint,
  onSelectDate,
  onPrevMonth,
  onNextMonth,
}: Props) {
  const scheme = useColorScheme() ?? 'light';
  const theme = colors[scheme];
  const { t } = useTranslation();
  const entryByDate = new Map(entries.map((e) => [e.date, e]));
  const todayKey = format(new Date(), 'yyyy-MM-dd');

  const start = startOfMonth(monthAnchor);
  const end = endOfMonth(monthAnchor);
  const days = eachDayOfInterval({ start, end });
  const leadingBlanks = getDay(start);

  return (
    <View className={cardClass({ padding: 'md', elevation: 'e1' }, 'gap-2')}>
      <View className="flex-row items-center justify-between">
        <Pressable accessibilityRole="button" onPress={onPrevMonth} hitSlop={8}>
          <ChevronBack size={16} color={theme.mutedForeground} />
        </Pressable>
        <Text variant="micro" className="font-sora-semibold">
          {formatDate(monthAnchor, 'monthYearLong')}
        </Text>
        <Pressable accessibilityRole="button" onPress={onNextMonth} hitSlop={8}>
          <ChevronForward size={16} color={theme.mutedForeground} />
        </Pressable>
      </View>

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
          const dateKey = format(day, 'yyyy-MM-dd');
          const entry = entryByDate.get(dateKey);
          const backgroundColor = entry?.flow
            ? alpha(tint, FLOW_ALPHA[entry.flow])
            : entry
              ? alpha(tint, LOGGED_NO_FLOW_ALPHA)
              : theme.muted;
          const today = isToday(day);
          const isFuture = dateKey > todayKey;

          return (
            <View key={dateKey} style={{ width: `${100 / 7}%` }} className="aspect-square p-0.5">
              <Pressable
                accessibilityRole="button"
                onPress={() => onSelectDate(dateKey)}
                disabled={isFuture}
                accessibilityLabel={formatDate(day, 'dayMonthLong')}
                accessibilityState={{ disabled: isFuture }}
                className="flex-1 items-center justify-center rounded-full"
                style={{
                  backgroundColor,
                  borderWidth: today ? 1.5 : 0,
                  borderColor: theme.accent,
                  opacity: isFuture ? 0.35 : 1,
                }}
              >
                <Text
                  variant="caption"
                  className="font-sora-medium"
                  style={{ color: entry ? tint : theme.mutedForeground }}
                >
                  {formatDayOfMonth(day)}
                </Text>
              </Pressable>
            </View>
          );
        })}
      </View>
    </View>
  );
}
