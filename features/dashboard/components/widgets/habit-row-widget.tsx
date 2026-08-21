import { useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { Repeat } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';

import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { moduleTint } from '@/constants/design-tokens';
import { colors } from '@/constants/theme';
import { alpha } from '@/lib/color';
import { WidgetCard } from '@/features/dashboard/components/widget-card';
import { WidgetEmptyState } from '@/features/dashboard/components/widget-empty-state';
import { useHabitRow } from '@/features/dashboard/hooks/use-widget-data';
import { useHabitMutations } from '@/features/habits/hooks/use-habit-mutations';

export function HabitRowWidget() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const { data, isLoading, error, refetch } = useHabitRow();
  const { logToday, unlogToday } = useHabitMutations();
  const habitTint = moduleTint('habit', scheme);

  const toggleHabit = (id: string, doneToday: boolean) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (doneToday) unlogToday.mutate(id);
    else logToday.mutate({ habitId: id });
    queryClient.invalidateQueries({ queryKey: ['dashboard', 'habit-row'] });
  };

  return (
    <WidgetCard
      error={error}
      onRetry={refetch}
      icon={Repeat}
      title={t('tabs.habits')}
      tint={moduleTint('habit', scheme)}
      actionLabel={t('dashboard.viewAll')}
      onActionPress={() => router.push('/(tabs)/habits')}
    >
      {isLoading || !data ? (
        <View className="flex-row gap-3">
          <Skeleton className="h-16 w-16 rounded-full" />
          <Skeleton className="h-16 w-16 rounded-full" />
          <Skeleton className="h-16 w-16 rounded-full" />
        </View>
      ) : data.habits.length === 0 ? (
        <WidgetEmptyState
          message={t('dashboard.noHabitsYet')}
          actionLabel={t('dashboard.addHabit')}
          onAction={() => router.push('/(tabs)/habits')}
        />
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerClassName="gap-3"
        >
          {data.habits.map((habit) => (
            <Pressable
              accessibilityRole="button"
              key={habit.id}
              onPress={() => toggleHabit(habit.id, habit.doneToday)}
              className="items-center gap-1.5"
            >
              <View
                className="h-16 w-16 items-center justify-center rounded-full border-2"
                style={{
                  borderColor: habit.doneToday ? habitTint : colors[scheme].border,
                  backgroundColor: habit.doneToday ? alpha(habitTint, 0.14) : 'transparent',
                }}
              >
                <Text className="text-2xl">{habit.emoji}</Text>
              </View>
              <Text variant="caption">{habit.name}</Text>
              <Text variant="caption">🔥{habit.streak}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </WidgetCard>
  );
}
