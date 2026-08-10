import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { Repeat, Search } from 'lucide-react-native';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshControl, TextInput, View } from 'react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { BottomSheetModal } from '@gorhom/bottom-sheet';

import { EmptyState } from '@/components/ui/empty-state';
import { QueryError } from '@/components/ui/query-error';
import { Fab } from '@/components/ui/fab';
import { ListSectionHeader } from '@/components/ui/list-section-header';
import { Skeleton } from '@/components/ui/skeleton';
import { ScreenHeader } from '@/components/ui/screen-header';
import { Text } from '@/components/ui/text';
import { moduleTint } from '@/constants/design-tokens';
import { colors } from '@/constants/theme';
import { HabitRow } from '@/features/habits/components/habit-row';
import { HabitsFabSheet } from '@/features/habits/components/habits-fab-sheet';
import { QuickLogSheet } from '@/features/habits/components/quick-log-sheet';
import { RoutineCard } from '@/features/habits/components/routine-card';
import { useHabitMutations } from '@/features/habits/hooks/use-habit-mutations';
import { useHabitCategories, useHabits } from '@/features/habits/hooks/use-habits';
import { useRoutines } from '@/features/habits/hooks/use-routines';
import { toDateKey } from '@/features/habits/services/habit-streaks';
import { useHabitsFilterStore } from '@/features/habits/store/habits-filter-store';
import type { HabitWithToday, RoutineWithHabits } from '@/features/habits/types/habit.types';

type ListItem =
  | { type: 'routine'; routine: RoutineWithHabits }
  | { type: 'header'; key: string; label: string; count: number; dotColor?: string }
  | { type: 'habit'; habit: HabitWithToday };

export default function HabitsScreen() {
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const quickLogRef = useRef<BottomSheetModal>(null);
  const fabSheetRef = useRef<BottomSheetModal>(null);
  const [quickLogHabit, setQuickLogHabit] = useState<HabitWithToday | null>(null);

  const { searchQuery, setSearchQuery } = useHabitsFilterStore();
  const { data: habits = [], isLoading, isError, refetch } = useHabits();
  const { data: routines = [] } = useRoutines();
  const { data: categories = [] } = useHabitCategories();
  const { logToday, unlogToday, logDate, archive, remove } = useHabitMutations();

  // Pull-to-refresh existed on the dashboard and nowhere else, so the reflex
  // gesture did nothing on every list in the app.
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const progress = useMemo(() => {
    const scheduledToday = habits.filter((habit) => habit.todayStatus !== 'not_scheduled');
    const done = scheduledToday.filter((habit) => habit.todayStatus === 'done').length;
    return { done, total: scheduledToday.length };
  }, [habits]);

  const items = useMemo<ListItem[]>(() => {
    const routineItems: ListItem[] = routines.map((routine) => ({ type: 'routine', routine }));
    const routinedIds = new Set(
      routines.flatMap((routine) => routine.habits.map((habit) => habit.id)),
    );
    const standalone = habits.filter((habit) => !routinedIds.has(habit.id));

    const byCategory = new Map<string | null, HabitWithToday[]>();
    for (const habit of standalone) {
      byCategory.set(habit.categoryId, [...(byCategory.get(habit.categoryId) ?? []), habit]);
    }

    const groupedItems: ListItem[] = [];
    for (const category of categories) {
      const group = byCategory.get(category.id);
      if (!group?.length) continue;
      groupedItems.push({
        type: 'header',
        key: category.id,
        label: category.name,
        count: group.length,
        dotColor: category.colorToken,
      });
      groupedItems.push(...group.map((habit) => ({ type: 'habit', habit }) as const));
    }

    const uncategorized = byCategory.get(null) ?? [];
    if (uncategorized.length > 0) {
      if (routineItems.length > 0 || groupedItems.length > 0) {
        groupedItems.push({
          type: 'header',
          key: 'other',
          label: t('habits.other'),
          count: uncategorized.length,
        });
      }
      groupedItems.push(...uncategorized.map((habit) => ({ type: 'habit', habit }) as const));
    }

    return [...routineItems, ...groupedItems];
  }, [routines, habits, categories, t]);

  const openQuickLog = (habit: HabitWithToday) => {
    setQuickLogHabit(habit);
    requestAnimationFrame(() => quickLogRef.current?.present());
  };

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader
        title={t('tabs.habits')}
        showBack={false}
        right={
          progress.total > 0 ? (
            <Text variant="muted" className="font-sora-medium">
              {t('habits.todayCount', { done: progress.done, total: progress.total })}
            </Text>
          ) : undefined
        }
      />

      <View className="gap-5 px-5 pb-2 pt-3">
        {progress.total > 0 && (
          <View className="h-1.5 overflow-hidden rounded-full bg-muted">
            <View
              className="h-full rounded-full bg-success"
              style={{ width: `${(progress.done / progress.total) * 100}%` }}
            />
          </View>
        )}

        <View className="flex-row items-center gap-2 rounded-full border border-border bg-surface px-4 py-2.5">
          <Search size={16} color={colors[scheme].mutedForeground} />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            accessibilityLabel={t('habits.searchHabits')}
            placeholder={t('habits.searchHabits')}
            placeholderTextColor={colors[scheme].mutedForeground}
            className="flex-1 text-foreground"
          />
        </View>
      </View>

      {isError ? (
        <QueryError onRetry={() => refetch()} message={t('habits.loadError')} />
      ) : isLoading ? (
        <View className="gap-2.5 px-5">
          <Skeleton className="h-16 w-full rounded-2xl" />
          <Skeleton className="h-16 w-full rounded-2xl" />
          <Skeleton className="h-16 w-full rounded-2xl" />
        </View>
      ) : items.length === 0 ? (
        <EmptyState
          icon={Repeat}
          title={t('habits.emptyTitle')}
          description={t('habits.emptyBody')}
          tint={moduleTint('habit', scheme)}
        />
      ) : (
        <FlashList
          data={items}
          keyExtractor={(item) =>
            item.type === 'header'
              ? `header-${item.key}`
              : item.type === 'routine'
                ? `routine-${item.routine.id}`
                : item.habit.id
          }
          contentContainerStyle={{ paddingTop: 4, paddingBottom: 120 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              // Without an explicit tint the spinner is invisible on dark.
              tintColor={colors[scheme].mutedForeground}
              colors={[colors[scheme].accent]}
            />
          }
          renderItem={({ item }) => {
            if (item.type === 'header')
              return (
                <ListSectionHeader label={item.label} count={item.count} dotColor={item.dotColor} />
              );
            if (item.type === 'routine') {
              return (
                <RoutineCard
                  routine={item.routine}
                  onEdit={() => router.push(`/routine/${item.routine.id}`)}
                  onOpenHabit={(habitId) => router.push(`/habit/${habitId}`)}
                  onToggleHabit={(habitId, done) =>
                    done ? unlogToday.mutate(habitId) : logToday.mutate({ habitId })
                  }
                />
              );
            }
            const habit = item.habit;
            return (
              <HabitRow
                habit={habit}
                onPress={() => router.push(`/habit/${habit.id}`)}
                onToggleDone={() =>
                  habit.todayStatus === 'done'
                    ? unlogToday.mutate(habit.id)
                    : logToday.mutate({ habitId: habit.id })
                }
                onQuickLog={() => openQuickLog(habit)}
                onArchive={() => archive.mutate(habit.id)}
                onDelete={() => remove.mutate(habit.id)}
              />
            );
          }}
        />
      )}

      <QuickLogSheet
        ref={quickLogRef}
        habit={quickLogHabit}
        onSubmit={(value) => {
          if (quickLogHabit)
            logDate.mutate({ habitId: quickLogHabit.id, logDate: toDateKey(new Date()), value });
        }}
      />

      <HabitsFabSheet ref={fabSheetRef} />
      <Fab
        onPress={() => fabSheetRef.current?.present()}
        accessibilityLabel={t('habits.addHabitOrRoutine')}
      />
    </View>
  );
}
