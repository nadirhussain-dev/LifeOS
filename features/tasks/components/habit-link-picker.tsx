import { useQuery } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView } from 'react-native';

import { Text } from '@/components/ui/text';
import { listHabitsWithToday } from '@/features/habits/services/habits-repository';
import { cn } from '@/lib/utils';

type Props = {
  value: string | null;
  onChange: (habitId: string | null) => void;
};

/**
 * Links this task to a habit — completing the task will log that habit for
 * the day (see `completeTask` in tasks-repository.ts). Shares its cache key
 * with `useHabits()` (['habits', false]) but skips that hook's search-box
 * `select` filter, the same reason Insights and the wiki-link autocomplete
 * both query habits/notes directly instead of through their list-screen hook.
 */
export function HabitLinkPicker({ value, onChange }: Props) {
  const { t } = useTranslation();
  const { data: habits = [] } = useQuery({
    queryKey: ['habits', false],
    queryFn: async () => listHabitsWithToday(false),
  });

  const select = (habitId: string | null) => {
    Haptics.selectionAsync();
    onChange(habitId);
  };

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerClassName="items-center gap-2"
    >
      <Pressable
        accessibilityRole="button"
        onPress={() => select(null)}
        className={cn(
          'rounded-full border px-3 py-1.5',
          value === null ? 'border-foreground bg-foreground' : 'border-border',
        )}
      >
        <Text className={value === null ? 'text-background' : 'text-muted-foreground'}>
          {t('fields.none')}
        </Text>
      </Pressable>

      {habits.map((habit) => {
        const selected = habit.id === value;
        return (
          <Pressable
            accessibilityRole="button"
            key={habit.id}
            onPress={() => select(habit.id)}
            className={cn(
              'flex-row items-center gap-1.5 rounded-full border px-3 py-1.5',
              selected ? 'border-accent bg-accent' : 'border-border',
            )}
          >
            <Text>{habit.emoji ?? '🔥'}</Text>
            <Text
              className={
                selected ? 'font-sora-medium text-accent-foreground' : 'text-muted-foreground'
              }
            >
              {habit.name}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
