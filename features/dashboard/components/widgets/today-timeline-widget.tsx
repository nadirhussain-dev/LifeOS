import { format } from 'date-fns';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { Clock3, Plus } from '@/components/ui/icons';
import { useColorScheme } from '@/hooks/use-color-scheme';

import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { moduleTint } from '@/constants/design-tokens';
import { colors } from '@/constants/theme';
import { WidgetCard } from '@/features/dashboard/components/widget-card';
import { WidgetEmptyState } from '@/features/dashboard/components/widget-empty-state';
import { useTodayTimeline } from '@/features/dashboard/hooks/use-widget-data';
import { toDateKey } from '@/lib/date';

export function TodayTimelineWidget() {
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const { data, isLoading, error, refetch } = useTodayTimeline();
  const todayKey = toDateKey(new Date());

  const addEvent = () =>
    router.push({ pathname: '/timeline/event/new', params: { date: todayKey } });

  return (
    <WidgetCard
      error={error}
      onRetry={refetch}
      icon={Clock3}
      title={t('dashboard.todaysTimeline')}
      tint={moduleTint('calendar', scheme)}
      actionLabel={t('dashboard.viewAll')}
      onActionPress={() => router.push(`/timeline/${todayKey}`)}
    >
      {isLoading || !data ? (
        <View className="gap-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </View>
      ) : data.events.length === 0 ? (
        <WidgetEmptyState
          message={t('dashboard.nothingOnTimeline')}
          actionLabel={t('dashboard.addEvent')}
          onAction={addEvent}
        />
      ) : (
        <View className="gap-2.5">
          {data.events.slice(0, 4).map((event) => (
            <View key={event.id} className="flex-row items-center gap-2.5">
              {event.colorToken && (
                <View
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: event.colorToken }}
                />
              )}
              <Text className="text-sm">{event.emoji}</Text>
              <Text className="flex-1" numberOfLines={1}>
                {event.title}
              </Text>
              <Text variant="caption">
                {format(event.time, 'h:mm a')}
                {event.endTime ? ` – ${format(event.endTime, 'h:mm a')}` : ''}
              </Text>
            </View>
          ))}
          <Pressable
            accessibilityRole="button"
            onPress={addEvent}
            className="flex-row items-center gap-1.5 pt-1"
            hitSlop={6}
          >
            <Plus size={13} color={colors[scheme].mutedForeground} />
            <Text variant="muted">{t('dashboard.addEvent')}</Text>
          </Pressable>
        </View>
      )}
    </WidgetCard>
  );
}
