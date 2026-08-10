import { format, parseISO } from 'date-fns';
import { useRouter } from 'expo-router';
import { Hourglass, Moon, Settings2, Sun } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';

import { cardClass } from '@/components/ui/card';
import { BarChart, type BarDatum } from '@/components/ui/bar-chart';
import { EmptyState } from '@/components/ui/empty-state';
import { QueryError } from '@/components/ui/query-error';
import { Fab } from '@/components/ui/fab';
import { ProgressBar } from '@/components/ui/progress-bar';
import { StatHero } from '@/components/ui/stat-hero';
import { ScreenHeader } from '@/components/ui/screen-header';
import { Segmented } from '@/components/ui/segmented';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { moduleTint } from '@/constants/design-tokens';
import { colors } from '@/constants/theme';
import { SleepSessionCard } from '@/features/sleep/components/sleep-session-card';
import { SleepStatsRow } from '@/features/sleep/components/sleep-stats-row';
import { SleepTrackerCard } from '@/features/sleep/components/sleep-tracker-card';
import { formatClock, formatDuration } from '@/features/sleep/services/sleep-stats';
import { useSleepInsights } from '@/features/sleep/hooks/use-sleep';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { alpha } from '@/lib/color';

const RANGE_OPTIONS = [
  { value: 'week' as const, labelKey: 'sleep.rangeWeek' },
  { value: 'month' as const, labelKey: 'sleep.rangeMonth' },
];

export default function SleepScreen() {
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const [range, setRange] = useState<'week' | 'month'>('week');
  const sleepTint = moduleTint('sleep', scheme);

  const { isLoading, isError, refetch, stats, trend, latest, goalMinutes, sessions } =
    useSleepInsights(range === 'week' ? 7 : 30);

  const lastNightRatio = latest ? Math.min(1, latest.durationMinutes / goalMinutes) : 0;

  const chartData: BarDatum[] = trend.map((point) => ({
    label:
      range === 'week' ? format(parseISO(point.date), 'EEEEE') : format(parseISO(point.date), 'd'),
    value: point.durationMinutes,
    color: point.metGoal ? sleepTint : alpha(sleepTint, 0.4),
  }));

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader
        title={t('sleep.title')}
        eyebrow={t('sleep.eyebrow')}
        tint={sleepTint}
        actions={[
          {
            icon: Settings2,
            label: t('sleep.settingsAction'),
            onPress: () => router.push('/sleep/settings'),
          },
        ]}
      />

      {isError ? (
        <QueryError onRetry={() => refetch()} />
      ) : isLoading ? (
        <View className="gap-5 px-5 pt-2">
          <Skeleton className="h-24 w-full rounded-2xl" />
          <Skeleton className="h-52 w-full rounded-2xl" />
        </View>
      ) : (
        <ScrollView
          contentContainerClassName="gap-5 px-5 pb-28"
          showsVerticalScrollIndicator={false}
        >
          {/* Live bedtime tracker — always available, even before any history */}
          <SleepTrackerCard />

          {sessions.length === 0 ? (
            <View style={{ minHeight: 300 }}>
              <EmptyState
                icon={Moon}
                title={t('sleep.emptyTitle')}
                description={t('sleep.emptyBody')}
                tint={sleepTint}
                actionLabel={t('sleep.logPastNight')}
                onAction={() => router.push('/sleep/log')}
              />
            </View>
          ) : (
            <>
              <StatHero
                eyebrow={
                  latest
                    ? t('sleep.lastNight', {
                        date: format(parseISO(latest.logDate), 'EEE, MMM d'),
                      })
                    : t('sleep.lastNightEyebrow', { defaultValue: 'Last night' })
                }
                value={latest ? formatDuration(latest.durationMinutes) : '—'}
                caption={t('sleep.ofGoal', { duration: formatDuration(goalMinutes) })}
                tint={sleepTint}
                icon={Moon}
                aside={<ProgressBar progress={lastNightRatio} color={sleepTint} height={6} />}
              />

              <SleepStatsRow stats={stats} />

              <View className={cardClass({ padding: 'md', elevation: 'e1' }, 'gap-3')}>
                <View className="flex-row items-center justify-between">
                  <Text variant="subheading">{t('sleep.trend')}</Text>
                  <View style={{ width: 160 }}>
                    <Segmented
                      options={RANGE_OPTIONS.map((option) => ({
                        ...option,
                        label: t(option.labelKey),
                      }))}
                      value={range}
                      onChange={setRange}
                      activeColor={sleepTint}
                    />
                  </View>
                </View>
                {chartData.length === 0 ? (
                  <Text variant="muted" className="py-6 text-center">
                    {t('sleep.noNightsInRange')}
                  </Text>
                ) : (
                  <BarChart
                    data={chartData}
                    color={sleepTint}
                    goalValue={goalMinutes}
                    labelEvery={range === 'week' ? 1 : 5}
                    height={170}
                  />
                )}
              </View>

              {stats.avgBedtimeMinutes !== null && stats.avgWakeMinutes !== null && (
                <View
                  className={cardClass(
                    { padding: 'md', elevation: 'e1' },
                    'flex-row items-center justify-around',
                  )}
                >
                  <View className="items-center gap-1">
                    <Moon size={18} color={sleepTint} />
                    <Text className="font-sora-bold text-foreground">
                      {formatClock(stats.avgBedtimeMinutes)}
                    </Text>
                    <Text variant="caption">{t('sleep.typicalBedtime')}</Text>
                  </View>
                  <View className="h-10 w-px bg-border" />
                  <View className="items-center gap-1">
                    <Sun size={18} color={colors[scheme].warning} />
                    <Text className="font-sora-bold text-foreground">
                      {formatClock(stats.avgWakeMinutes)}
                    </Text>
                    <Text variant="caption">{t('sleep.typicalWake')}</Text>
                  </View>
                  {stats.avgFellAsleepMinutes !== null && (
                    <>
                      <View className="h-10 w-px bg-border" />
                      <View className="items-center gap-1">
                        <Hourglass size={18} color={colors[scheme].success} />
                        <Text className="font-sora-bold text-foreground">
                          {formatDuration(stats.avgFellAsleepMinutes)}
                        </Text>
                        <Text variant="caption">{t('sleep.toFallAsleep')}</Text>
                      </View>
                    </>
                  )}
                </View>
              )}

              <View className="gap-3">
                <Text variant="subheading">{t('sleep.history')}</Text>
                <View className="gap-2.5">
                  {sessions.slice(0, 14).map((session) => (
                    <SleepSessionCard
                      key={session.id}
                      session={session}
                      goalMinutes={goalMinutes}
                      onPress={(s) => router.push(`/sleep/log?id=${s.id}`)}
                    />
                  ))}
                </View>
              </View>
            </>
          )}
        </ScrollView>
      )}

      <Fab onPress={() => router.push('/sleep/log')} accessibilityLabel={t('sleep.logSleep')} />
    </View>
  );
}
