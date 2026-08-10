import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { CheckCircle2, Search } from 'lucide-react-native';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, RefreshControl, TextInput, View } from 'react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';

import { EmptyState } from '@/components/ui/empty-state';
import { QueryError } from '@/components/ui/query-error';
import { Fab } from '@/components/ui/fab';
import { ListSectionHeader } from '@/components/ui/list-section-header';
import { Skeleton } from '@/components/ui/skeleton';
import { ScreenHeader } from '@/components/ui/screen-header';
import { Text } from '@/components/ui/text';
import { colors } from '@/constants/theme';
import { TaskRow } from '@/features/tasks/components/task-row';
import { useTaskMutations } from '@/features/tasks/hooks/use-task-mutations';
import { useTasks } from '@/features/tasks/hooks/use-tasks';
import { groupTasksByDueDate } from '@/features/tasks/services/task-grouping';
import { useTasksFilterStore } from '@/features/tasks/store/tasks-filter-store';
import type { Task, TaskDueBucket, TaskListFilter } from '@/features/tasks/types/task.types';
import { toast } from '@/lib/toast-store';

type ListItem =
  | { type: 'header'; bucket: TaskDueBucket; labelKey: string; count: number }
  | { type: 'task'; task: Task };

const FILTER_TABS: { value: TaskListFilter; labelKey: string }[] = [
  { value: 'active', labelKey: 'tasks.filterActive' },
  { value: 'completed', labelKey: 'tasks.filterCompleted' },
  { value: 'archived', labelKey: 'tasks.filterArchived' },
];

export default function TasksScreen() {
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();

  const { filter, setFilter, searchQuery, setSearchQuery } = useTasksFilterStore();
  const { data: tasks = [], isLoading, isError, refetch } = useTasks();
  const { complete, reopen, archive, remove, restore } = useTaskMutations();

  // Pull-to-refresh existed on the dashboard and nowhere else, so the reflex
  // gesture did nothing on every list in the app.
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const bucketDotColor: Record<TaskDueBucket, string | undefined> = {
    overdue: colors[scheme].destructive,
    today: colors[scheme].accent,
    upcoming: undefined,
    'no-date': undefined,
  };

  const items = useMemo<ListItem[]>(() => {
    if (filter !== 'active') {
      return tasks.map((task) => ({ type: 'task', task }) as const);
    }
    return groupTasksByDueDate(tasks).flatMap((section) => [
      {
        type: 'header',
        bucket: section.bucket,
        labelKey: section.labelKey,
        count: section.tasks.length,
      } as const,
      ...section.tasks.map((task) => ({ type: 'task', task }) as const),
    ]);
  }, [tasks, filter]);

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title={t('tabs.tasks')} showBack={false} />

      <View className="gap-5 px-5 pb-2 pt-3">
        <View className="flex-row items-center gap-2 rounded-full border border-border bg-surface px-4 py-2.5">
          <Search size={16} color={colors[scheme].mutedForeground} />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            accessibilityLabel={t('tasks.searchTasks')}
            placeholder={t('tasks.searchTasks')}
            placeholderTextColor={colors[scheme].mutedForeground}
            className="flex-1 text-foreground"
          />
        </View>

        <View className="flex-row gap-1.5 rounded-full border border-border bg-surface p-1">
          {FILTER_TABS.map((tab) => {
            const selected = tab.value === filter;
            return (
              <Pressable
                key={tab.value}
                onPress={() => setFilter(tab.value)}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                accessibilityLabel={t(tab.labelKey)}
                className={
                  selected
                    ? 'flex-1 items-center rounded-full bg-primary py-2'
                    : 'flex-1 items-center rounded-full py-2'
                }
              >
                <Text
                  className={
                    selected
                      ? 'font-sora-semibold text-primary-foreground'
                      : 'text-muted-foreground'
                  }
                >
                  {t(tab.labelKey)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {isError ? (
        <QueryError onRetry={() => refetch()} message={t('tasks.loadError')} />
      ) : isLoading ? (
        <View className="gap-2.5 px-5">
          <Skeleton className="h-16 w-full rounded-2xl" />
          <Skeleton className="h-16 w-full rounded-2xl" />
          <Skeleton className="h-16 w-full rounded-2xl" />
        </View>
      ) : items.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title={
            filter === 'active'
              ? t('tasks.emptyTitle')
              : filter === 'completed'
                ? t('tasks.emptyCompleted')
                : t('tasks.emptyArchived')
          }
          description={filter === 'active' ? t('tasks.emptyActive') : t('tasks.emptyOther')}
        />
      ) : (
        <FlashList
          data={items}
          keyExtractor={(item) =>
            item.type === 'header' ? `header-${item.labelKey}` : item.task.id
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
          renderItem={({ item }) =>
            item.type === 'header' ? (
              <ListSectionHeader
                label={t(item.labelKey)}
                count={item.count}
                dotColor={bucketDotColor[item.bucket]}
              />
            ) : (
              <TaskRow
                task={item.task}
                onPress={() => router.push(`/task/${item.task.id}`)}
                onToggleComplete={() =>
                  item.task.status === 'completed'
                    ? reopen.mutate(item.task.id)
                    : complete.mutate(item.task.id)
                }
                onArchive={() => {
                  const { id, title } = item.task;
                  archive.mutate(id, {
                    onSuccess: () =>
                      toast.undo(t('tasks.archivedToast', { title }), t('common.undo'), () =>
                        reopen.mutate(id),
                      ),
                  });
                }}
                onDelete={() => {
                  // Deletes are tombstones, so the row can come straight back.
                  // An undo window beats a confirmation dialog here: dialogs get
                  // dismissed reflexively, undo does not.
                  const { id, title } = item.task;
                  remove.mutate(id, {
                    onSuccess: () =>
                      toast.undo(t('tasks.deletedToast', { title }), t('common.undo'), () =>
                        restore.mutate(id),
                      ),
                  });
                }}
              />
            )
          }
        />
      )}

      <Fab onPress={() => router.push('/task/new')} accessibilityLabel={t('tasks.addTask')} />
    </View>
  );
}
