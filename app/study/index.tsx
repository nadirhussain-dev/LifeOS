import { format, parseISO } from 'date-fns';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';
import {
  GraduationCap,
  Minus,
  NotebookPen,
  Play,
  Plus,
  Settings2,
  Timer,
} from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { cardClass } from '@/components/ui/card';
import { BarChart, type BarDatum } from '@/components/ui/bar-chart';
import { EmptyState } from '@/components/ui/empty-state';
import { QueryError } from '@/components/ui/query-error';
import { GradientButton } from '@/components/ui/gradient-button';
import { ProgressBar } from '@/components/ui/progress-bar';
import { StatHero } from '@/components/ui/stat-hero';
import { ScreenHeader } from '@/components/ui/screen-header';
import { Segmented } from '@/components/ui/segmented';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { moduleTint } from '@/constants/design-tokens';
import { colors } from '@/constants/theme';
import { StudyInsightsCard } from '@/features/study/components/study-insights-card';
import { StudyStatsRow } from '@/features/study/components/study-stats-row';
import { StudySessionCard } from '@/features/study/components/study-session-card';
import { SubjectBreakdownList } from '@/features/study/components/subject-breakdown';
import { SubjectPicker } from '@/features/study/components/subject-picker';
import { formatStudyDuration } from '@/features/study/services/study-stats';
import { useStudyInsights } from '@/features/study/hooks/use-study';
import { useStudyMutations } from '@/features/study/hooks/use-study-mutations';
import { useStudyTimerStore } from '@/features/study/store/study-timer-store';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { alpha } from '@/lib/color';
import { confirm } from '@/lib/dialog-store';

const RANGE_OPTIONS = [
  { value: 'week' as const, labelKey: 'study.rangeWeek' },
  { value: 'month' as const, labelKey: 'study.rangeMonth' },
];
const MODE_OPTIONS = [
  { value: 'pomodoro' as const, labelKey: 'study.modePomodoro' },
  { value: 'custom' as const, labelKey: 'study.modeCustom' },
  { value: 'stopwatch' as const, labelKey: 'study.modeStopwatch' },
];

type StartMode = 'pomodoro' | 'custom' | 'stopwatch';

export default function StudyScreen() {
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const [range, setRange] = useState<'week' | 'month'>('week');
  const [mode, setMode] = useState<StartMode>('pomodoro');
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [customMinutes, setCustomMinutes] = useState(50);
  const studyTint = moduleTint('study', scheme);

  const {
    isLoading,
    isError,
    refetch,
    stats,
    trend,
    breakdown,
    insights,
    subjects,
    settings,
    dailyGoalSeconds,
    sessions,
  } = useStudyInsights(range === 'week' ? 7 : 30);
  const { addSubject, removeSession } = useStudyMutations();
  const configureAndStart = useStudyTimerStore((s) => s.configureAndStart);
  const timerActive = useStudyTimerStore((s) => s.active);

  const todayRatio = dailyGoalSeconds > 0 ? Math.min(1, stats.todaySeconds / dailyGoalSeconds) : 0;

  const subjectById = new Map(subjects.map((s) => [s.id, s]));

  const chartData: BarDatum[] = trend.map((point) => ({
    label:
      range === 'week' ? format(parseISO(point.date), 'EEEEE') : format(parseISO(point.date), 'd'),
    value: Math.round(point.seconds / 60),
    color: point.metGoal ? studyTint : alpha(studyTint, 0.4),
  }));

  const start = () => {
    const focusSeconds =
      mode === 'pomodoro' ? settings.focusMinutes * 60 : mode === 'custom' ? customMinutes * 60 : 0;
    const breakSeconds = mode === 'pomodoro' ? settings.breakMinutes * 60 : 0;
    configureAndStart({ mode, subjectId, focusSeconds, breakSeconds });
    router.push('/study/timer');
  };

  const startLabel =
    mode === 'pomodoro'
      ? t('study.startFocus', { minutes: settings.focusMinutes })
      : mode === 'custom'
        ? t('study.startSession', { minutes: customMinutes })
        : t('study.startStopwatch');

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader
        title={t('study.title')}
        eyebrow={t('study.eyebrow')}
        tint={studyTint}
        actions={[
          {
            icon: NotebookPen,
            label: t('study.logPastAction'),
            onPress: () => router.push('/study/log'),
          },
          {
            icon: Settings2,
            label: t('study.settingsAction'),
            onPress: () => router.push('/study/settings'),
          },
        ]}
      />

      {isError ? (
        <QueryError onRetry={() => refetch()} />
      ) : isLoading ? (
        <View className="gap-5 px-5 pt-2">
          <Skeleton className="h-52 w-full rounded-2xl" />
          <Skeleton className="h-40 w-full rounded-2xl" />
        </View>
      ) : (
        <ScrollView
          contentContainerClassName="gap-5 px-5 pb-28"
          showsVerticalScrollIndicator={false}
        >
          {timerActive && (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/study/timer')}
              className="flex-row items-center gap-3 rounded-2xl bg-study p-4"
            >
              <Timer size={20} color="#ffffff" />
              <Text className="flex-1 font-sora-semibold" style={{ color: '#ffffff' }}>
                {t('study.sessionInProgress')}
              </Text>
              <Text className="font-sora-semibold" style={{ color: '#ffffff' }}>
                {t('study.resumeArrow')}
              </Text>
            </Pressable>
          )}

          <StatHero
            eyebrow={t('study.today')}
            value={formatStudyDuration(stats.todaySeconds)}
            caption={t('study.ofToday', { duration: formatStudyDuration(dailyGoalSeconds) })}
            tint={studyTint}
            icon={GraduationCap}
            aside={<ProgressBar progress={todayRatio} color={studyTint} height={6} />}
          />

          {/* Start a session */}
          <View className={cardClass({ padding: 'md', elevation: 'e1' }, 'gap-3')}>
            <Text variant="subheading">{t('study.startFocusing')}</Text>
            <SubjectPicker
              subjects={subjects}
              value={subjectId}
              onChange={setSubjectId}
              onCreate={(name, colorToken) =>
                addSubject.mutate(
                  { name, colorToken },
                  { onSuccess: (created) => setSubjectId(created.id) },
                )
              }
            />
            <Segmented
              options={MODE_OPTIONS.map((option) => ({ ...option, label: t(option.labelKey) }))}
              value={mode}
              onChange={setMode}
              activeColor={studyTint}
            />

            {mode === 'custom' && (
              <View className="flex-row items-center justify-between rounded-xl bg-surface px-3 py-2">
                <Text variant="muted">{t('study.focusLength')}</Text>
                <View className="flex-row items-center gap-4">
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setCustomMinutes((m) => Math.max(5, m - 5))}
                    hitSlop={6}
                  >
                    <Minus size={18} color={colors[scheme].foreground} />
                  </Pressable>
                  <Text
                    className="font-sora-bold text-foreground"
                    style={{ minWidth: 56, textAlign: 'center' }}
                  >
                    {t('study.minutesShort', { minutes: customMinutes })}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setCustomMinutes((m) => Math.min(180, m + 5))}
                    hitSlop={6}
                  >
                    <Plus size={18} color={colors[scheme].foreground} />
                  </Pressable>
                </View>
              </View>
            )}

            <GradientButton label={startLabel} tint={studyTint} icon={Play} onPress={start} />
          </View>

          {sessions.length === 0 ? (
            <View style={{ minHeight: 160 }}>
              <EmptyState
                icon={GraduationCap}
                title={t('study.emptyTitle')}
                description={t('study.emptyBody')}
                tint={studyTint}
                actionLabel={t('study.logPastTime')}
                onAction={() => router.push('/study/log')}
              />
            </View>
          ) : (
            <>
              <StudyStatsRow stats={stats} />

              <StudyInsightsCard insights={insights} />

              <View className={cardClass({ padding: 'md', elevation: 'e1' }, 'gap-3')}>
                <View className="flex-row items-center justify-between">
                  <Text variant="subheading">{t('study.focusTime')}</Text>
                  <View style={{ width: 160 }}>
                    <Segmented
                      options={RANGE_OPTIONS.map((option) => ({
                        ...option,
                        label: t(option.labelKey),
                      }))}
                      value={range}
                      onChange={setRange}
                      activeColor={studyTint}
                    />
                  </View>
                </View>
                <BarChart
                  data={chartData}
                  color={studyTint}
                  goalValue={settings.dailyGoalMinutes}
                  labelEvery={range === 'week' ? 1 : 5}
                  height={170}
                />
              </View>

              {breakdown.length > 0 && (
                <View className={cardClass({ padding: 'md', elevation: 'e1' }, 'gap-3')}>
                  <Text variant="subheading">{t('study.bySubjectThisWeek')}</Text>
                  <SubjectBreakdownList breakdown={breakdown} />
                </View>
              )}

              <View className="gap-3">
                <Text variant="subheading">{t('study.recentSessions')}</Text>
                <View className="gap-2.5">
                  {sessions.slice(0, 12).map((session) => (
                    <StudySessionCard
                      key={session.id}
                      session={session}
                      subject={
                        session.subjectId ? (subjectById.get(session.subjectId) ?? null) : null
                      }
                      onLongPress={(s) =>
                        void confirm({
                          title: t('study.deleteSessionTitle'),
                          message: t('study.deleteSessionBody'),
                          confirmLabel: t('common.delete'),
                          cancelLabel: t('common.cancel'),
                          destructive: true,
                        }).then(async (ok) => {
                          if (!ok) return;
                          removeSession.mutate(s.id);
                        })
                      }
                    />
                  ))}
                </View>
              </View>
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}
