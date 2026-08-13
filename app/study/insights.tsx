import {
  endOfMonth,
  format,
  isWithinInterval,
  parseISO,
  startOfMonth,
  subDays,
  subMonths,
} from 'date-fns';
import { useState } from 'react';
import { Clock, Hash, Star, Sunrise } from 'lucide-react-native';
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
import { SubjectBreakdownList } from '@/features/study/components/subject-breakdown';
import { useStudyInsights } from '@/features/study/hooks/use-study';
import {
  computeStudyInsights,
  formatStudyDuration,
  subjectBreakdown,
  timeOfDayLabelKey,
} from '@/features/study/services/study-stats';
import type { StudySession } from '@/features/study/types/study.types';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { alpha } from '@/lib/color';

type Range = 'week' | 'month' | 'year';

const RANGE_DAYS: Record<Range, number> = { week: 7, month: 30, year: 365 };

/** Total minutes per of the last `months` calendar months — the year view's
 *  chart granularity. 365 daily bars would be unreadable, so the trend rolls
 *  up to a monthly total, the same move Sleep's year view makes. */
function buildMonthlyStudyTrend(sessions: StudySession[], months: number): BarDatum[] {
  const now = new Date();
  const points: BarDatum[] = [];
  for (let i = months - 1; i >= 0; i -= 1) {
    const monthDate = subMonths(now, i);
    const start = startOfMonth(monthDate);
    const end = endOfMonth(monthDate);
    const totalSeconds = sessions
      .filter((s) => isWithinInterval(parseISO(s.logDate), { start, end }))
      .reduce((sum, s) => sum + s.durationSeconds, 0);
    points.push({ label: format(monthDate, 'MMM'), value: Math.round(totalSeconds / 60) });
  }
  return points;
}

export default function StudyInsightsScreen() {
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const studyTint = moduleTint('study', scheme);
  const [range, setRange] = useState<Range>('week');

  const { isLoading, isError, refetch, sessions, subjects, trend, dailyGoalSeconds } =
    useStudyInsights(RANGE_DAYS[range]);

  const sinceDate = format(subDays(new Date(), RANGE_DAYS[range] - 1), 'yyyy-MM-dd');
  const rangeSessions = sessions.filter((s) => s.logDate >= sinceDate);
  const totalSeconds = rangeSessions.reduce((sum, s) => sum + s.durationSeconds, 0);
  const rangeInsights = computeStudyInsights(rangeSessions);
  const breakdown = subjectBreakdown(sessions, subjects, sinceDate);

  const chartData: BarDatum[] =
    range === 'year'
      ? buildMonthlyStudyTrend(sessions, 12)
      : trend.map((point) => ({
          label:
            range === 'week'
              ? format(parseISO(point.date), 'EEEEE')
              : format(parseISO(point.date), 'd'),
          value: Math.round(point.seconds / 60),
          color: point.metGoal ? studyTint : alpha(studyTint, 0.4),
        }));

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title={t('study.insightsTitle')} eyebrow={t('study.title')} tint={studyTint} />

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
              { value: 'week' as const, label: t('study.rangeWeek') },
              { value: 'month' as const, label: t('study.rangeMonth') },
              { value: 'year' as const, label: t('study.rangeYear') },
            ]}
            value={range}
            onChange={setRange}
            activeColor={studyTint}
          />

          {rangeSessions.length === 0 ? (
            <Text variant="muted" className="py-10 text-center">
              {t('study.noSessionsInRange')}
            </Text>
          ) : (
            <>
              <View className="flex-row gap-2.5">
                <StatTile
                  icon={Clock}
                  value={formatStudyDuration(totalSeconds)}
                  label={t('study.focusTime')}
                  tint={studyTint}
                  index={0}
                />
                <StatTile
                  icon={Hash}
                  value={String(rangeSessions.length)}
                  label={t('study.sessions')}
                  tint={studyTint}
                  index={1}
                />
                <StatTile
                  icon={Star}
                  value={
                    rangeInsights.avgFocusRating != null
                      ? rangeInsights.avgFocusRating.toFixed(1)
                      : '—'
                  }
                  label={t('study.avgFocus')}
                  tint={studyTint}
                  index={2}
                />
                <StatTile
                  icon={Sunrise}
                  value={
                    rangeInsights.bestTimeOfDay
                      ? t(timeOfDayLabelKey(rangeInsights.bestTimeOfDay))
                      : '—'
                  }
                  label={t('study.youFocusBestIn')}
                  tint={studyTint}
                  index={3}
                />
              </View>

              <View className={cardClass({ padding: 'md', elevation: 'e1' }, 'gap-3')}>
                <Text variant="subheading">{t('study.focusTime')}</Text>
                <BarChart
                  data={chartData}
                  color={studyTint}
                  goalValue={range === 'year' ? undefined : Math.round(dailyGoalSeconds / 60)}
                  labelEvery={range === 'week' ? 1 : range === 'month' ? 5 : 1}
                  height={170}
                />
              </View>

              {breakdown.length > 0 && (
                <View className={cardClass({ padding: 'md', elevation: 'e1' }, 'gap-3')}>
                  <Text variant="subheading">{t('study.bySubject')}</Text>
                  <SubjectBreakdownList breakdown={breakdown} />
                </View>
              )}
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}
