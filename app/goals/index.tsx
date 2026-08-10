import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { ArrowUpDown, Search, Target } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, TextInput, View } from 'react-native';

import { EmptyState } from '@/components/ui/empty-state';
import { QueryError } from '@/components/ui/query-error';
import { Fab } from '@/components/ui/fab';
import { ScreenHeader } from '@/components/ui/screen-header';
import { Segmented } from '@/components/ui/segmented';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { contentTints, moduleTint, resolveTint } from '@/constants/design-tokens';
import { colors } from '@/constants/theme';
import { GOAL_CATEGORIES } from '@/features/goals/config/goal-categories';
import { GoalCard } from '@/features/goals/components/goal-card';
import { GoalsStatsHeader } from '@/features/goals/components/goals-stats-header';
import { useGoals, useGoalStats } from '@/features/goals/hooks/use-goals';
import { useGoalsFilterStore, type GoalSort } from '@/features/goals/store/goals-filter-store';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { cn } from '@/lib/utils';

const STATUS_OPTIONS = [
  { value: 'active' as const, labelKey: 'goals.filterActive' },
  { value: 'completed' as const, labelKey: 'goals.filterCompleted' },
  { value: 'archived' as const, labelKey: 'goals.filterArchived' },
];

const SORT_LABEL_KEYS: Record<GoalSort, string> = {
  manual: 'goals.sortDefault',
  progress: 'goals.sortProgress',
  due: 'goals.sortDue',
  priority: 'goals.sortPriority',
  created: 'goals.sortNewest',
};

const EMPTY_TITLE_KEYS = {
  active: 'goals.emptyTitle',
  completed: 'goals.emptyCompleted',
  archived: 'goals.emptyArchived',
} as const;

const SORT_CYCLE: GoalSort[] = ['manual', 'progress', 'due', 'priority', 'created'];

export default function GoalsScreen() {
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const [showSearch, setShowSearch] = useState(false);

  const { data: goals = [], isLoading, isError, refetch } = useGoals();
  const { data: stats } = useGoalStats();
  const {
    searchQuery,
    setSearchQuery,
    statusFilter,
    setStatusFilter,
    categoryFilter,
    setCategoryFilter,
    sort,
    setSort,
  } = useGoalsFilterStore();

  const cycleSort = () => {
    const next = SORT_CYCLE[(SORT_CYCLE.indexOf(sort) + 1) % SORT_CYCLE.length];
    setSort(next);
  };

  const header = (
    <View className="gap-5 pb-2">
      {stats && (statusFilter === 'active' ? stats.activeCount > 0 : true) && (
        <GoalsStatsHeader
          activeCount={stats.activeCount}
          completedCount={stats.completedCount}
          avgProgress={stats.avgProgress}
          nextDue={stats.nextDue}
        />
      )}

      <Segmented
        options={STATUS_OPTIONS.map((option) => ({ ...option, label: t(option.labelKey) }))}
        value={statusFilter}
        onChange={setStatusFilter}
      />

      {showSearch && (
        <View className="flex-row items-center gap-2 rounded-full border border-border bg-surface px-4 py-2.5">
          <Search size={16} color={colors[scheme].mutedForeground} />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder={t('goals.searchGoals')}
            placeholderTextColor={colors[scheme].mutedForeground}
            autoFocus
            className="flex-1 text-foreground"
          />
        </View>
      )}

      <CategoryChips categoryFilter={categoryFilter} setCategoryFilter={setCategoryFilter} />
    </View>
  );

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader
        title={t('goals.title')}
        eyebrow={t('goals.eyebrow')}
        tint={moduleTint('goals', scheme)}
        actions={[
          { icon: Search, label: t('common.search'), onPress: () => setShowSearch((s) => !s) },
          {
            icon: ArrowUpDown,
            label: t('goals.changeSort'),
            onPress: cycleSort,
            text: t(SORT_LABEL_KEYS[sort]),
          },
        ]}
      />

      {isError ? (
        <QueryError onRetry={() => refetch()} />
      ) : isLoading ? (
        <View className="gap-3 px-5 pt-2">
          <Skeleton className="h-28 w-full rounded-2xl" />
          <Skeleton className="h-24 w-full rounded-2xl" />
          <Skeleton className="h-24 w-full rounded-2xl" />
        </View>
      ) : (
        <FlashList
          data={goals}
          keyExtractor={(goal) => goal.id}
          ListHeaderComponent={header}
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 4, paddingBottom: 120 }}
          ItemSeparatorComponent={() => <View className="h-3" />}
          ListEmptyComponent={
            <View style={{ minHeight: 340 }}>
              <EmptyState
                icon={Target}
                title={t(EMPTY_TITLE_KEYS[statusFilter])}
                description={
                  statusFilter === 'active' ? t('goals.emptyActive') : t('goals.emptyOther')
                }
                tint={moduleTint('goals', scheme)}
                actionLabel={statusFilter === 'active' ? t('goals.createGoal') : undefined}
                onAction={statusFilter === 'active' ? () => router.push('/goals/new') : undefined}
              />
            </View>
          }
          renderItem={({ item }) => (
            <GoalCard goal={item} onPress={(goal) => router.push(`/goals/${goal.id}`)} />
          )}
        />
      )}

      <Fab onPress={() => router.push('/goals/new')} accessibilityLabel={t('goals.addGoal')} />
    </View>
  );
}

/** Horizontally-scrolling category filter chips (All + each category). */
function CategoryChips({
  categoryFilter,
  setCategoryFilter,
}: {
  categoryFilter: string;
  setCategoryFilter: (c: never) => void;
}) {
  const { t } = useTranslation();
  const scheme = useColorScheme() ?? 'light';
  const items = [
    { id: 'all', labelKey: 'common.all', tint: contentTints.neutral },
    ...GOAL_CATEGORIES,
  ];
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerClassName="items-center gap-2"
    >
      {items.map((item) => {
        const selected = categoryFilter === item.id;
        return (
          <Pressable
            accessibilityRole="button"
            key={item.id}
            onPress={() => setCategoryFilter(item.id as never)}
            style={
              selected
                ? {
                    backgroundColor: resolveTint(item.tint, scheme),
                    borderColor: resolveTint(item.tint, scheme),
                  }
                : undefined
            }
            className={cn('rounded-full border px-3 py-1.5', !selected && 'border-border')}
          >
            <Text className={selected ? 'font-sora-medium text-white' : 'text-muted-foreground'}>
              {t(item.labelKey)}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
