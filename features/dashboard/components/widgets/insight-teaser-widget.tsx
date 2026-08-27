import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Sparkles } from '@/components/ui/icons';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { WidgetCard } from '@/features/dashboard/components/widget-card';
import { WidgetEmptyState } from '@/features/dashboard/components/widget-empty-state';
import { useInsightTeaser } from '@/features/dashboard/hooks/use-widget-data';
import { INSIGHT_SENTENCE_KEY } from '@/features/insights/config/insight-copy';

/**
 * A compact preview of the Insights screen's headline, right on the
 * dashboard — the app's actual front door. The full screen is one tile among
 * many in the Hub grid, easy to never open; this is what makes the
 * cross-module correlation the thing people actually see, not a feature they
 * have to go looking for.
 */
export function InsightTeaserWidget() {
  const router = useRouter();
  const { t } = useTranslation();
  const { data, isLoading, error, refetch } = useInsightTeaser();

  return (
    <WidgetCard
      error={error}
      onRetry={refetch}
      icon={Sparkles}
      title={t('dashboard.lifeInsights')}
      actionLabel={t('dashboard.viewAll')}
      onActionPress={() => router.push('/insights')}
    >
      {isLoading || !data ? (
        <Skeleton className="h-10 w-full" />
      ) : data.status === 'ready' && data.headline ? (
        <Text className="leading-5">
          {t(INSIGHT_SENTENCE_KEY[data.headline.key], data.headline.params)}
        </Text>
      ) : (
        <WidgetEmptyState message={t('dashboard.insightsComingSoon')} />
      )}
    </WidgetCard>
  );
}
