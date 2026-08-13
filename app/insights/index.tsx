import { format, parseISO } from 'date-fns';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';

import { cardClass } from '@/components/ui/card';
import { DualTrendChart } from '@/components/ui/dual-trend-chart';
import { QueryError } from '@/components/ui/query-error';
import { ScreenHeader } from '@/components/ui/screen-header';
import { Segmented } from '@/components/ui/segmented';
import { Skeleton } from '@/components/ui/skeleton';
import { StatTile } from '@/components/ui/stat-tile';
import { Text } from '@/components/ui/text';
import { moduleTint } from '@/constants/design-tokens';
import { useBudgetSettings } from '@/features/budget/hooks/use-budget';
import { formatMoneyCompact } from '@/features/budget/services/money';
import { INSIGHT_MODULE_ICON, INSIGHT_MODULE_TOKEN } from '@/features/insights/config/insight-copy';
import { InsightHeroCard } from '@/features/insights/components/insight-hero-card';
import { PatternCard } from '@/features/insights/components/pattern-card';
import { useLifeInsights } from '@/features/insights/hooks/use-insights';
import { formatDuration } from '@/features/sleep/services/sleep-stats';
import { useColorScheme } from '@/hooks/use-color-scheme';

// Week/month only, deliberately — the whole point of this screen is a
// day-level correlation, which a year's monthly rollup would average away.
type Range = 'week' | 'month';
const RANGE_DAYS: Record<Range, number> = { week: 7, month: 30 };

function average(values: number[]): number | null {
  return values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : null;
}

export default function InsightsScreen() {
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  // Month by default: a week rarely has enough days for the engine's own
  // sample-size bar to clear, so 'week' would show "not enough data" for
  // most people on first open.
  const [range, setRange] = useState<Range>('month');
  const rangeDays = RANGE_DAYS[range];

  const { isLoading, isError, refetch, daily, insights } = useLifeInsights(rangeDays);
  const { data: budgetSettings } = useBudgetSettings();
  const currency = budgetSettings?.currency ?? '$';

  const sleepTint = moduleTint(INSIGHT_MODULE_TOKEN.sleep, scheme);
  const studyTint = moduleTint(INSIGHT_MODULE_TOKEN.study, scheme);
  const habitTint = moduleTint(INSIGHT_MODULE_TOKEN.habit, scheme);
  const budgetTint = moduleTint(INSIGHT_MODULE_TOKEN.budget, scheme);
  const SleepIcon = INSIGHT_MODULE_ICON.sleep;
  const StudyIcon = INSIGHT_MODULE_ICON.study;
  const HabitIcon = INSIGHT_MODULE_ICON.habit;
  const BudgetIcon = INSIGHT_MODULE_ICON.budget;

  const avgSleepMinutes = average(
    daily.filter((d) => d.sleepMinutes != null).map((d) => d.sleepMinutes as number),
  );
  const avgFocusRating = average(
    daily.filter((d) => d.focusRating != null).map((d) => d.focusRating as number),
  );
  const scheduledTotal = daily.reduce((sum, d) => sum + d.habitsScheduled, 0);
  const completedTotal = daily.reduce((sum, d) => sum + d.habitsCompleted, 0);
  const habitsRate =
    scheduledTotal > 0 ? Math.round((completedTotal / scheduledTotal) * 100) : null;
  const totalSpendCents = daily.reduce((sum, d) => sum + d.spendCents, 0);

  const chartData = daily.map((d) => ({
    label: range === 'week' ? format(parseISO(d.date), 'EEEEE') : format(parseISO(d.date), 'd'),
    barValue: (d.sleepMinutes ?? 0) / 60,
    lineValue: d.focusRating,
  }));
  const hasChartData = daily.some((d) => d.sleepMinutes != null || d.focusRating != null);

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title={t('insights.title')} eyebrow={t('insights.eyebrow')} />

      {isError ? (
        <QueryError onRetry={() => refetch()} />
      ) : isLoading ? (
        <View className="gap-5 px-5 pt-2">
          <Skeleton className="h-32 w-full rounded-2xl" />
          <Skeleton className="h-24 w-full rounded-2xl" />
          <Skeleton className="h-52 w-full rounded-2xl" />
        </View>
      ) : (
        <ScrollView
          contentContainerClassName="gap-5 px-5 pb-10"
          showsVerticalScrollIndicator={false}
        >
          <Segmented
            options={[
              { value: 'week' as const, label: t('insights.rangeWeek') },
              { value: 'month' as const, label: t('insights.rangeMonth') },
            ]}
            value={range}
            onChange={setRange}
          />

          <InsightHeroCard
            status={insights.status}
            headline={insights.headline}
            rangeDays={rangeDays}
          />

          <View className="flex-row gap-2.5">
            <StatTile
              icon={SleepIcon}
              value={avgSleepMinutes != null ? formatDuration(avgSleepMinutes) : '—'}
              label={t('insights.avgSleep')}
              tint={sleepTint}
              index={0}
            />
            <StatTile
              icon={StudyIcon}
              value={avgFocusRating != null ? avgFocusRating.toFixed(1) : '—'}
              label={t('insights.avgFocus')}
              tint={studyTint}
              index={1}
            />
            <StatTile
              icon={HabitIcon}
              value={habitsRate != null ? `${habitsRate}%` : '—'}
              label={t('insights.habitsDone')}
              tint={habitTint}
              index={2}
            />
            <StatTile
              icon={BudgetIcon}
              value={formatMoneyCompact(totalSpendCents, currency)}
              label={t('insights.spent')}
              tint={budgetTint}
              index={3}
            />
          </View>

          <View className={cardClass({ padding: 'md', elevation: 'e1' }, 'gap-3')}>
            <Text variant="subheading">{t('insights.sleepVsFocus')}</Text>
            <View className="flex-row gap-3.5">
              <View className="flex-row items-center gap-1.5">
                <View className="h-2 w-2 rounded-sm" style={{ backgroundColor: sleepTint }} />
                <Text variant="caption">{t('insights.legendSleep')}</Text>
              </View>
              <View className="flex-row items-center gap-1.5">
                <View className="h-2 w-2 rounded-sm" style={{ backgroundColor: studyTint }} />
                <Text variant="caption">{t('insights.legendFocus')}</Text>
              </View>
            </View>
            {hasChartData ? (
              <DualTrendChart
                data={chartData}
                barColor={sleepTint}
                lineColor={studyTint}
                labelEvery={range === 'week' ? 1 : 5}
                height={170}
              />
            ) : (
              <Text variant="muted" className="py-6 text-center">
                {t('insights.noChartData')}
              </Text>
            )}
          </View>

          {insights.patterns.length > 0 && (
            <View className="gap-2">
              <Text variant="subheading">{t('insights.otherPatterns')}</Text>
              {insights.patterns.map((candidate) => (
                <PatternCard key={candidate.key} candidate={candidate} />
              ))}
            </View>
          )}

          <Text variant="caption" className="pt-1 text-center">
            {t('insights.updatesAutomatically')}
          </Text>
        </ScrollView>
      )}
    </View>
  );
}
