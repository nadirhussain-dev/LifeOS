import {
  differenceInCalendarDays,
  endOfMonth,
  format,
  isWithinInterval,
  parseISO,
  startOfMonth,
  subMonths,
} from 'date-fns';
import { useState } from 'react';
import { CalendarDays, Moon, Star, Target } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';

import { BarChart, type BarDatum } from '@/components/ui/bar-chart';
import { cardClass } from '@/components/ui/card';
import { QueryError } from '@/components/ui/query-error';
import { ScreenHeader } from '@/components/ui/screen-header';
import { Segmented } from '@/components/ui/segmented';
import { Skeleton } from '@/components/ui/skeleton';
import { StatTile } from '@/components/ui/stat-tile';
import { Text } from '@/components/ui/text';
import { moduleTint } from '@/constants/design-tokens';
import { useSleepInsights } from '@/features/sleep/hooks/use-sleep';
import { formatDuration } from '@/features/sleep/services/sleep-stats';
import type { SleepSession } from '@/features/sleep/types/sleep.types';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { alpha } from '@/lib/color';

type Range = 'week' | 'month' | 'year';

const RANGE_DAYS: Record<Range, number> = { week: 7, month: 30, year: 365 };

/** One bar per of the last `months` calendar months — the year view's chart
 *  granularity. 365 individual daily bars would be unreadable, so the trend
 *  aggregates to a month average instead, the same move Budget's
 *  "expenses last 6 months" chart makes over the same underlying data shape. */
function buildMonthlyTrend(sessions: SleepSession[], months: number): BarDatum[] {
  const now = new Date();
  const points: BarDatum[] = [];
  for (let i = months - 1; i >= 0; i -= 1) {
    const monthDate = subMonths(now, i);
    const start = startOfMonth(monthDate);
    const end = endOfMonth(monthDate);
    const inMonth = sessions.filter((s) => isWithinInterval(parseISO(s.logDate), { start, end }));
    const avg =
      inMonth.length > 0
        ? inMonth.reduce((sum, s) => sum + s.durationMinutes, 0) / inMonth.length
        : 0;
    points.push({ label: format(monthDate, 'MMM'), value: Math.round(avg) });
  }
  return points;
}

function averageQuality(sessions: SleepSession[]): number | null {
  const rated = sessions.filter((s) => s.quality != null);
  if (rated.length === 0) return null;
  return rated.reduce((sum, s) => sum + (s.quality ?? 0), 0) / rated.length;
}

export default function SleepInsightsScreen() {
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const sleepTint = moduleTint('sleep', scheme);
  const [range, setRange] = useState<Range>('week');

  const rangeDays = RANGE_DAYS[range];
  const { isLoading, isError, refetch, sessions, trend, goalMinutes } = useSleepInsights(
    Math.min(rangeDays, 365),
  );

  const rangeSessions = sessions.filter(
    (s) => differenceInCalendarDays(new Date(), parseISO(s.logDate)) < rangeDays,
  );
  const nightsInRange = rangeSessions.length;
  const avgDurationInRange =
    nightsInRange > 0
      ? rangeSessions.reduce((sum, s) => sum + s.durationMinutes, 0) / nightsInRange
      : 0;
  const goalMetRate =
    nightsInRange > 0
      ? Math.round(
          (rangeSessions.filter((s) => s.durationMinutes >= goalMinutes).length / nightsInRange) *
            100,
        )
      : 0;
  const quality = averageQuality(rangeSessions);

  const chartData: BarDatum[] =
    range === 'year'
      ? buildMonthlyTrend(sessions, 12)
      : trend.map((point) => ({
          label:
            range === 'week'
              ? format(parseISO(point.date), 'EEEEE')
              : format(parseISO(point.date), 'd'),
          value: point.durationMinutes,
          color: point.metGoal ? sleepTint : alpha(sleepTint, 0.4),
        }));

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title={t('sleep.insightsTitle')} eyebrow={t('sleep.title')} tint={sleepTint} />

      {isError ? (
        <QueryError onRetry={() => refetch()} />
      ) : isLoading ? (
        <View className="gap-5 px-5 pt-2">
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
              { value: 'week' as const, label: t('sleep.rangeWeek') },
              { value: 'month' as const, label: t('sleep.rangeMonth') },
              { value: 'year' as const, label: t('sleep.rangeYear') },
            ]}
            value={range}
            onChange={setRange}
            activeColor={sleepTint}
          />

          {nightsInRange === 0 ? (
            <Text variant="muted" className="py-10 text-center">
              {t('sleep.noNightsInRange')}
            </Text>
          ) : (
            <>
              <View className="flex-row gap-2.5">
                <StatTile
                  icon={Moon}
                  value={formatDuration(avgDurationInRange)}
                  label={t('sleep.avgPerNight')}
                  tint={sleepTint}
                  index={0}
                />
                <StatTile
                  icon={Target}
                  value={`${goalMetRate}%`}
                  label={t('sleep.goalMetRate')}
                  tint={sleepTint}
                  index={1}
                />
                <StatTile
                  icon={CalendarDays}
                  value={String(nightsInRange)}
                  label={t('sleep.nightsTracked')}
                  tint={sleepTint}
                  index={2}
                />
                <StatTile
                  icon={Star}
                  value={quality != null ? quality.toFixed(1) : '—'}
                  label={t('sleep.avgQuality')}
                  tint={sleepTint}
                  index={3}
                />
              </View>

              <View className={cardClass({ padding: 'md', elevation: 'e1' }, 'gap-3')}>
                <Text variant="subheading">{t('sleep.trend')}</Text>
                {chartData.every((point) => point.value === 0) ? (
                  <Text variant="muted" className="py-6 text-center">
                    {t('sleep.noNightsInRange')}
                  </Text>
                ) : (
                  <BarChart
                    data={chartData}
                    color={sleepTint}
                    goalValue={range === 'year' ? undefined : goalMinutes}
                    labelEvery={range === 'week' ? 1 : range === 'month' ? 5 : 1}
                    height={170}
                  />
                )}
              </View>
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}
