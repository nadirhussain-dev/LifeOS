import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { cardClass } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ArrowDownRight, ArrowUpRight, Minus, Sparkles } from '@/components/ui/icons';
import { QueryError } from '@/components/ui/query-error';
import { ScreenHeader } from '@/components/ui/screen-header';
import { SectionHeader } from '@/components/ui/section-header';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { colors } from '@/constants/theme';
import { formatMoney } from '@/features/budget/services/money';
import { useBudgetSettings } from '@/features/budget/hooks/use-budget';
import { INSIGHT_ACTION } from '@/features/insights/config/insight-actions';
import { INSIGHT_SENTENCE_KEY } from '@/features/insights/config/insight-copy';
import { useWeeklyReview } from '@/features/insights/hooks/use-weekly-review';
import {
  formatChange,
  formatReviewValue,
  REVIEW_METRIC_LABEL,
} from '@/features/insights/services/review-formatting';
import type { ReviewMetric } from '@/features/insights/services/weekly-review';
import { useColorScheme } from '@/hooks/use-color-scheme';

/**
 * The weekly review.
 *
 * The ritual the whole app is arranged around: once a week, what moved, what
 * slipped, one pattern, and one thing to change — with the control that changes
 * it one tap away. No collection of single-purpose apps can assemble this
 * screen, because half its numbers would be in a competitor's database.
 *
 * Deliberately short. A review that lists every metric is a dashboard, and a
 * dashboard is something people stop opening.
 */
export default function WeeklyReviewScreen() {
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const { review, insights, isLoading, isError, refetch } = useWeeklyReview();
  const { data: budgetSettings } = useBudgetSettings();
  const currency = budgetSettings?.currency ?? 'USD';

  const value = (metric: ReviewMetric) => {
    if (metric.current == null) return '—';
    // Money is the one metric whose unit belongs to the user rather than the
    // metric, so it is formatted here where the currency is known.
    return metric.key === 'spendCents'
      ? formatMoney(Math.round(metric.current), currency)
      : formatReviewValue(metric.key, metric.current);
  };

  const row = (metric: ReviewMetric, tone: 'up' | 'down' | 'flat') => {
    const Icon = tone === 'up' ? ArrowUpRight : tone === 'down' ? ArrowDownRight : Minus;
    const tint =
      tone === 'up'
        ? colors[scheme].success
        : tone === 'down'
          ? colors[scheme].destructive
          : colors[scheme].mutedForeground;

    return (
      <View key={metric.key} className="flex-row items-center gap-3 py-2.5">
        <Icon size={16} color={tint} />
        <Text className="flex-1 font-sora-medium">
          {t(REVIEW_METRIC_LABEL[metric.key] ?? metric.key)}
        </Text>
        <Text className="font-sora-semibold text-foreground">{value(metric)}</Text>
        {metric.relativeChange != null && (
          <Text variant="caption" style={{ color: tint, minWidth: 48, textAlign: 'right' }}>
            {formatChange(metric.relativeChange)}
          </Text>
        )}
      </View>
    );
  };

  const headline = insights.headline;
  const action = headline ? INSIGHT_ACTION[headline.key] : null;
  const hasComparison = review.moved.length > 0 || review.slipped.length > 0;

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title={t('insights.reviewTitle')} />

      {isError ? (
        <QueryError onRetry={() => refetch()} />
      ) : isLoading ? (
        <View className="gap-2.5 px-5">
          <Skeleton className="h-24 w-full rounded-2xl" />
          <Skeleton className="h-40 w-full rounded-2xl" />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 48, gap: 20 }}
          showsVerticalScrollIndicator={false}
        >
          <Text variant="muted">
            {t('insights.reviewLoggedDays', { count: review.loggedDays })}
          </Text>

          {!hasComparison && review.steady.length === 0 ? (
            <EmptyState
              icon={Sparkles}
              title={t('insights.reviewEmptyTitle')}
              description={t('insights.reviewEmptyBody')}
            />
          ) : (
            <>
              {review.moved.length > 0 && (
                <View className="gap-2">
                  <SectionHeader title={t('insights.reviewMoved')} />
                  <View className={cardClass({ padding: 'none', elevation: 'e1' }, 'px-4')}>
                    {review.moved.map((metric) => row(metric, 'up'))}
                  </View>
                </View>
              )}

              {review.slipped.length > 0 && (
                <View className="gap-2">
                  <SectionHeader title={t('insights.reviewSlipped')} />
                  <View className={cardClass({ padding: 'none', elevation: 'e1' }, 'px-4')}>
                    {review.slipped.map((metric) => row(metric, 'down'))}
                  </View>
                </View>
              )}

              {!hasComparison && <Text variant="muted">{t('insights.reviewNothingChanged')}</Text>}

              {review.steady.length > 0 && (
                <View className="gap-2">
                  <SectionHeader title={t('insights.reviewSteady')} />
                  <View className={cardClass({ padding: 'none', elevation: 'e1' }, 'px-4')}>
                    {review.steady.map((metric) => row(metric, 'flat'))}
                  </View>
                </View>
              )}
            </>
          )}

          {/* One pattern, never a list. Several findings on a review screen is
              a horoscope however well each was tested. */}
          {headline && (
            <View className="gap-2">
              <SectionHeader title={t('insights.reviewOnePattern')} />
              <View className={cardClass({ padding: 'lg', elevation: 'e1' }, 'gap-2')}>
                <Text className="font-sora-medium leading-6 text-foreground">
                  {t(INSIGHT_SENTENCE_KEY[headline.key], headline.params)}
                </Text>
                <Text variant="caption">{t('insights.movesTogether')}</Text>
                <Text variant="caption">
                  {t('insights.evidence', {
                    days: headline.sampleSize,
                    pairs: insights.pairsTested,
                  })}
                </Text>
              </View>
            </View>
          )}

          {/* The whole point: a finding you can act on without going to look
              for the setting. A route rather than a silent write — see
              insight-actions.ts. */}
          {action && (
            <View className="gap-2">
              <SectionHeader title={t('insights.reviewOneChange')} />
              <Button
                label={t(action.labelKey)}
                variant="accent"
                size="lg"
                onPress={() => router.push(action.route as never)}
              />
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}
