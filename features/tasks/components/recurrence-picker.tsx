import * as Haptics from 'expo-haptics';
import { Minus, Plus } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';

import { Segmented } from '@/components/ui/segmented';
import { Text } from '@/components/ui/text';
import { WeekdayPicker } from '@/components/ui/weekday-picker';
import { colors } from '@/constants/theme';
import { WEEKDAY_PRESET, type RecurrenceRule } from '@/features/tasks/services/task-recurrence';
import type {
  TaskRecurrenceAnchor,
  TaskRecurrenceFrequency,
} from '@/features/tasks/types/task.types';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { cn } from '@/lib/utils';

const OPTIONS: { value: TaskRecurrenceFrequency; labelKey: string }[] = [
  { value: 'none', labelKey: 'recurrence.oneTime' },
  { value: 'daily', labelKey: 'recurrence.daily' },
  { value: 'weekly', labelKey: 'recurrence.weekly' },
  { value: 'monthly', labelKey: 'recurrence.monthly' },
  { value: 'yearly', labelKey: 'recurrence.yearly' },
];

/** The plural key family describing "every N <unit>" for each frequency. */
const INTERVAL_KEY: Record<Exclude<TaskRecurrenceFrequency, 'none'>, string> = {
  daily: 'recurrence.everyDays',
  weekly: 'recurrence.everyWeeks',
  monthly: 'recurrence.everyMonths',
  yearly: 'recurrence.everyYears',
};

/** Above this a repeat is better expressed by changing the unit, and the
 *  stepper stops being a sensible way to reach the number. */
const MAX_INTERVAL = 30;

type Props = {
  value: RecurrenceRule;
  onChange: (value: RecurrenceRule) => void;
};

/**
 * The full repeat rule: how often, how many, which days, and what the count
 * runs from.
 *
 * Everything past the frequency row is revealed only once the task actually
 * repeats, and the weekday row only for a weekly one — a one-time task showing
 * an interval stepper and an anchor toggle is three controls asking about a
 * decision the user has already declined to make.
 */
export function RecurrencePicker({ value, onChange }: Props) {
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();

  const repeats = value.frequency !== 'none';
  const setInterval = (interval: number) => {
    Haptics.selectionAsync();
    onChange({ ...value, interval: Math.min(MAX_INTERVAL, Math.max(1, interval)) });
  };

  return (
    <View className="gap-3">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerClassName="items-center gap-2"
      >
        {OPTIONS.map((option) => {
          const selected = option.value === value.frequency;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected }}
              key={option.value}
              onPress={() => {
                Haptics.selectionAsync();
                // Chosen weekdays belong to a weekly rule. Carrying them onto a
                // monthly one leaves an invisible setting that reappears if the
                // user ever switches back, having silently survived a choice
                // that should have cleared it.
                onChange({
                  ...value,
                  frequency: option.value,
                  daysOfWeek: option.value === 'weekly' ? value.daysOfWeek : null,
                });
              }}
              style={
                selected
                  ? { backgroundColor: colors[scheme].accent, borderColor: colors[scheme].accent }
                  : undefined
              }
              className={cn('rounded-full border px-3 py-1.5', !selected && 'border-border')}
            >
              <Text
                className={cn('font-sora-medium', !selected && 'text-muted-foreground')}
                style={selected ? { color: colors[scheme].accentForeground } : undefined}
              >
                {t(option.labelKey)}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {repeats && (
        <View className="flex-row items-center justify-between">
          <Text variant="muted">
            {t(INTERVAL_KEY[value.frequency as Exclude<TaskRecurrenceFrequency, 'none'>], {
              count: value.interval,
            })}
          </Text>
          <View className="flex-row items-center gap-1">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('recurrence.decreaseInterval')}
              disabled={value.interval <= 1}
              onPress={() => setInterval(value.interval - 1)}
              hitSlop={8}
              className={cn(
                'h-8 w-8 items-center justify-center rounded-full border border-border',
                value.interval <= 1 && 'opacity-40',
              )}
            >
              <Minus size={14} color={colors[scheme].foreground} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('recurrence.increaseInterval')}
              disabled={value.interval >= MAX_INTERVAL}
              onPress={() => setInterval(value.interval + 1)}
              hitSlop={8}
              className={cn(
                'h-8 w-8 items-center justify-center rounded-full border border-border',
                value.interval >= MAX_INTERVAL && 'opacity-40',
              )}
            >
              <Plus size={14} color={colors[scheme].foreground} />
            </Pressable>
          </View>
        </View>
      )}

      {value.frequency === 'weekly' && (
        <View className="gap-2">
          <View className="flex-row items-center justify-between">
            <Text variant="micro" className="font-sora-semibold">
              {t('recurrence.onDays')}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                Haptics.selectionAsync();
                onChange({ ...value, daysOfWeek: WEEKDAY_PRESET });
              }}
              hitSlop={8}
            >
              <Text variant="micro" style={{ color: colors[scheme].accent }}>
                {t('recurrence.weekdays')}
              </Text>
            </Pressable>
          </View>
          <WeekdayPicker
            value={value.daysOfWeek ?? []}
            onChange={(days) => onChange({ ...value, daysOfWeek: days.length > 0 ? days : null })}
          />
        </View>
      )}

      {repeats && (
        <Segmented<TaskRecurrenceAnchor>
          options={[
            { value: 'due_date', label: t('recurrence.fromDueDate') },
            { value: 'completion', label: t('recurrence.afterCompletion') },
          ]}
          value={value.anchor}
          onChange={(anchor) => onChange({ ...value, anchor })}
          activeColor={colors[scheme].accent}
        />
      )}
    </View>
  );
}
