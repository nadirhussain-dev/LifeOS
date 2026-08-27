import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { TrendingUp } from '@/components/ui/icons';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { WidgetCard } from '@/features/dashboard/components/widget-card';
import { useProductivitySummary } from '@/features/dashboard/hooks/use-widget-data';

export function ProductivitySummaryWidget() {
  const { t } = useTranslation();
  const { data, isLoading, error, refetch } = useProductivitySummary();

  return (
    <WidgetCard error={error} onRetry={refetch} icon={TrendingUp} title={t('dashboard.thisWeek')}>
      {isLoading || !data ? (
        <Skeleton className="h-14 w-full" />
      ) : (
        <View className="gap-3">
          <Text variant="muted">
            {t('dashboard.percentTasksCompleted', {
              percent: Math.round(data.weeklyCompletionRate * 100),
            })}
          </Text>
          <View className="h-14 flex-row items-end gap-1.5">
            {data.trend.map((value, index) => {
              // Today (the last bar) reads at full strength; earlier days sit
              // back at lower opacity so the eye lands on "now".
              const isToday = index === data.trend.length - 1;
              return (
                <View
                  key={index}
                  className="h-full flex-1 justify-end overflow-hidden rounded-md bg-muted"
                >
                  <View
                    className="w-full rounded-md bg-accent"
                    style={{ height: `${Math.max(value * 100, 5)}%`, opacity: isToday ? 1 : 0.45 }}
                  />
                </View>
              );
            })}
          </View>
        </View>
      )}
    </WidgetCard>
  );
}
