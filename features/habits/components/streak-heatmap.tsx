import { addDays } from 'date-fns/addDays';
import { subDays } from 'date-fns/subDays';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';

import { Text } from '@/components/ui/text';
import { colors as semanticColors } from '@/constants/design-tokens';
import { colors } from '@/constants/theme';
import { isHabitScheduledOn, toDateKey } from '@/features/habits/services/habit-streaks';
import type { Habit, HabitLog, HabitSkip } from '@/features/habits/types/habit.types';

const WEEKS = 18;

type Props = {
  habit: Pick<Habit, 'scheduleType' | 'scheduleDays' | 'scheduleIntervalDays' | 'createdAt'>;
  logs: HabitLog[];
  skips: HabitSkip[];
};

/**
 * Plain-View grid rather than a canvas surface — bounded to the last ~126
 * days so it stays cheap without pulling in react-native-skia. Revisit with
 * a canvas renderer if this ever needs to show multi-year history.
 */
export function StreakHeatmap({ habit, logs, skips }: Props) {
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const logDates = new Set(logs.map((log) => log.logDate));
  const skipDates = new Set(skips.map((skip) => skip.logDate));

  const today = new Date();
  const totalDays = WEEKS * 7;
  const start = subDays(today, totalDays - 1);

  const columns: {
    key: string;
    done: boolean;
    skipped: boolean;
    scheduled: boolean;
    isFuture: boolean;
  }[][] = [];
  let cursor = start;
  for (let week = 0; week < WEEKS; week += 1) {
    const column = [];
    for (let day = 0; day < 7; day += 1) {
      const key = toDateKey(cursor);
      column.push({
        key,
        done: logDates.has(key),
        skipped: skipDates.has(key),
        scheduled: isHabitScheduledOn(habit, key),
        isFuture: cursor > today,
      });
      cursor = addDays(cursor, 1);
    }
    columns.push(column);
  }

  return (
    <View className="gap-2">
      <View className="flex-row gap-1">
        {columns.map((column) => (
          <View key={column[0].key} className="gap-1">
            {column.map((cell) => {
              let backgroundColor: string = 'transparent';
              let borderColor: string = colors[scheme].border;
              if (cell.done) {
                backgroundColor = semanticColors[scheme].success;
                borderColor = semanticColors[scheme].success;
              } else if (cell.skipped) {
                backgroundColor = colors[scheme].muted;
              } else if (!cell.scheduled || cell.isFuture) {
                borderColor = 'transparent';
              }
              return (
                <View
                  key={cell.key}
                  className="h-3 w-3 rounded-sm border"
                  style={{ backgroundColor, borderColor }}
                />
              );
            })}
          </View>
        ))}
      </View>
      <View className="flex-row items-center gap-3">
        <View className="flex-row items-center gap-1">
          <View className="h-2.5 w-2.5 rounded-sm bg-success" />
          <Text variant="caption">{t('habits.done')}</Text>
        </View>
        <View className="flex-row items-center gap-1">
          <View
            className="h-2.5 w-2.5 rounded-sm"
            style={{ backgroundColor: colors[scheme].muted }}
          />
          <Text variant="caption">{t('habits.skipped')}</Text>
        </View>
      </View>
    </View>
  );
}
