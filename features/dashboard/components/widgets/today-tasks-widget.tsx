import { useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { ListChecks } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';

import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { colors } from '@/constants/theme';
import { WidgetCard } from '@/features/dashboard/components/widget-card';
import { WidgetEmptyState } from '@/features/dashboard/components/widget-empty-state';
import { useTodayTasks } from '@/features/dashboard/hooks/use-widget-data';
import { useTaskMutations } from '@/features/tasks/hooks/use-task-mutations';

export function TodayTasksWidget() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const { data, isLoading, error, refetch } = useTodayTasks();
  const { complete } = useTaskMutations();

  const completeTask = (id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    complete.mutate(id, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ['dashboard', 'today-tasks'] }),
    });
  };

  return (
    <WidgetCard
      error={error}
      onRetry={refetch}
      icon={ListChecks}
      title={t('dashboard.today')}
      actionLabel={t('dashboard.viewAll')}
      onActionPress={() => router.push('/(tabs)/tasks')}
    >
      {isLoading || !data ? (
        <View className="gap-2">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </View>
      ) : data.totalCount === 0 ? (
        <WidgetEmptyState
          message={t('dashboard.noTasksYet')}
          actionLabel={t('dashboard.addTask')}
          onAction={() => router.push('/task/new')}
        />
      ) : (
        <View className="gap-3">
          <Text variant="muted">
            {t('dashboard.xOfYDone', { completed: data.completedCount, total: data.totalCount })}
          </Text>
          {data.upcoming.length === 0 ? (
            <Text variant="muted">{t('dashboard.allDoneToday')}</Text>
          ) : (
            <View className="gap-2">
              {data.upcoming.map((task) => (
                <Pressable
                  accessibilityRole="button"
                  key={task.id}
                  onPress={() => completeTask(task.id)}
                  className="flex-row items-center gap-3 rounded-xl bg-surface px-3 py-2.5"
                >
                  <View
                    className="h-5 w-5 rounded-full border-2"
                    style={{ borderColor: colors[scheme].border }}
                  />
                  <Text className="flex-1" numberOfLines={1}>
                    {task.title}
                  </Text>
                  {task.overdue || task.dueLabel ? (
                    <Text
                      variant="caption"
                      style={task.overdue ? { color: colors[scheme].destructive } : undefined}
                    >
                      {task.overdue ? t('buckets.overdue') : task.dueLabel}
                    </Text>
                  ) : null}
                </Pressable>
              ))}
            </View>
          )}
        </View>
      )}
    </WidgetCard>
  );
}
