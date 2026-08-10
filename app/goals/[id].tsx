import { format } from 'date-fns';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Archive, Check, Pencil, Plus, RotateCcw, TrendingUp, Trash2 } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';

import { cardClass } from '@/components/ui/card';
import { CelebrationOverlay } from '@/components/ui/celebration-overlay';
import { GradientButton } from '@/components/ui/gradient-button';
import { HeroCard } from '@/components/ui/hero-card';
import { LineChart } from '@/components/ui/line-chart';
import { ProgressRing } from '@/components/ui/progress-ring';
import { ScreenHeader } from '@/components/ui/screen-header';
import { SectionHeader } from '@/components/ui/section-header';
import { Text } from '@/components/ui/text';
import { colors as dsColors, moduleTint } from '@/constants/design-tokens';
import { colors } from '@/constants/theme';
import { goalCategoryLabel, goalCategoryMeta } from '@/features/goals/config/goal-categories';
import { goalPriorityColor } from '@/features/goals/config/goal-priority';
import { MilestoneTimeline } from '@/features/goals/components/milestone-timeline';
import { formatDueDate, formatProgressPercent } from '@/features/goals/services/goal-format';
import { buildProgressSeries, goalTimeline } from '@/features/goals/services/goal-timeline';
import { useGoal, useGoalMilestones, useGoalProgressLogs } from '@/features/goals/hooks/use-goals';
import { useGoalMutations } from '@/features/goals/hooks/use-goal-mutations';
import type { GoalPace } from '@/features/goals/types/goal.types';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { alpha } from '@/lib/color';
import { confirm } from '@/lib/dialog-store';

// Labels only. This used to carry a `color` per pace as well — a green/blue/
// amber ladder that nothing ever read, so the pace has always rendered in plain
// foreground. `paceTints` in the token file now holds that ladder properly
// (from the semantic set, so "behind" reads as caution); wire it in here if the
// pace should be coloured, rather than reviving four hardcoded hexes.
const PACE_LABEL: Record<GoalPace, string> = {
  ahead: 'goals.paceAhead',
  on_track: 'goals.paceOnTrack',
  behind: 'goals.paceBehind',
  none: '',
};

const WHITE = '#ffffff';

export default function GoalDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const [celebrate, setCelebrate] = useState(false);

  const { data: goal } = useGoal(id);
  const { data: milestones = [] } = useGoalMilestones(id);
  const { data: logs = [] } = useGoalProgressLogs(id);
  const mutations = useGoalMutations();

  if (!goal) return null;

  const meta = goalCategoryMeta(goal.category, scheme);
  const Icon = meta.icon;
  const isCompleted = goal.status === 'completed';
  const isMilestones = goal.progressMode === 'milestones';
  const readyToComplete = !isCompleted && goal.progress >= 1;
  const due = goal.dueDate && !isCompleted ? formatDueDate(goal.dueDate, t) : null;

  const timeline = goalTimeline(goal, goal.progress);
  const paceLabel = PACE_LABEL[timeline.pace];
  const series = buildProgressSeries(goal, goal.progress, logs, milestones);
  const rangeEnd = goal.dueDate ?? Date.now();
  const showChart =
    timeline.hasDeadline || logs.length > 0 || milestones.some((m) => m.isCompleted);

  const confirmDelete = () => {
    void confirm({
      title: t('goals.deleteTitle'),
      message: t('goals.deleteBody', { title: goal.title }),
      confirmLabel: t('common.delete'),
      cancelLabel: t('common.cancel'),
      destructive: true,
    }).then(async (ok) => {
      if (!ok) return;
      mutations.remove.mutate(goal.id);
      router.back();
    });
  };

  const handleComplete = () => {
    mutations.complete.mutate(goal.id);
    setCelebrate(true);
  };

  const activity = [...logs].sort((a, b) => b.loggedAt - a.loggedAt);
  const formatDelta = (delta: number) =>
    isMilestones || goal.progressMode === 'percent'
      ? `${delta > 0 ? '+' : ''}${Math.round(delta * 100)}%`
      : `${delta > 0 ? '+' : ''}${delta} ${goal.unit ?? ''}`;

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen options={{ headerShown: false }} />

      <ScreenHeader
        eyebrow={t('goals.title')}
        tint={moduleTint('goals', scheme)}
        right={
          <View className="flex-row gap-4">
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push(`/goals/${goal.id}/edit`)}
              hitSlop={8}
              accessibilityLabel={t('common.edit')}
            >
              <Pencil size={19} color={colors[scheme].foreground} />
            </Pressable>
            {!isCompleted && (
              <Pressable
                accessibilityRole="button"
                onPress={() => (mutations.archive.mutate(goal.id), router.back())}
                hitSlop={8}
                accessibilityLabel={t('common.archive')}
              >
                <Archive size={19} color={colors[scheme].foreground} />
              </Pressable>
            )}
            <Pressable
              accessibilityRole="button"
              onPress={confirmDelete}
              hitSlop={8}
              accessibilityLabel={t('common.delete')}
            >
              <Trash2 size={19} color={colors[scheme].destructive} />
            </Pressable>
          </View>
        }
      />

      <ScrollView
        contentContainerClassName="gap-5 px-5 pt-1 pb-10"
        showsVerticalScrollIndicator={false}
      >
        {/* Hero: ring + time/pace */}
        <HeroCard tint={meta.tint}>
          <View className="items-center gap-4">
            <ProgressRing
              progress={goal.progress}
              size={158}
              strokeWidth={13}
              color={WHITE}
              trackColor={alpha(WHITE, 0.25)}
            >
              <View className="items-center">
                <Text
                  className="font-sora-extrabold text-4xl"
                  style={{ color: WHITE, fontVariant: ['tabular-nums'] }}
                >
                  {formatProgressPercent(goal.progress)}
                </Text>
                <View className="flex-row items-center gap-1">
                  <Icon size={12} color={alpha(WHITE, 0.9)} />
                  <Text
                    style={{ color: alpha(WHITE, 0.9), fontSize: 12 }}
                    className="font-sora-semibold"
                  >
                    {goalCategoryLabel(goal.category, goal.categoryLabel, t)}
                  </Text>
                </View>
              </View>
            </ProgressRing>

            {timeline.hasDeadline && !isCompleted ? (
              <View
                className="w-full flex-row rounded-2xl p-3"
                style={{ backgroundColor: alpha(WHITE, 0.15) }}
              >
                {[
                  {
                    value: t('goals.dayN', { n: timeline.dayNumber }),
                    label: t('goals.ofTotalDays', { total: timeline.totalDays }),
                  },
                  {
                    value: timeline.isOverdue ? t('goals.overdue') : `${timeline.remainingDays}`,
                    label: timeline.isOverdue ? '' : t('goals.daysLeftCaption'),
                  },
                  {
                    value: paceLabel ? t(paceLabel) : '',
                    label: paceLabel ? t('goals.pace') : '',
                  },
                ].map((stat, i) => (
                  <View key={i} className="flex-1 items-center gap-0.5">
                    <Text className="font-sora-bold" style={{ color: WHITE }}>
                      {stat.value}
                    </Text>
                    <Text style={{ color: alpha(WHITE, 0.8), fontSize: 11 }}>{stat.label}</Text>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={{ color: alpha(WHITE, 0.9) }} className="font-sora-medium">
                {isCompleted ? t('goals.completedCelebrate') : t('goals.noDeadlineSet')}
              </Text>
            )}
          </View>
        </HeroCard>

        {/* Title */}
        <View className="gap-1">
          <Text className="font-sora-bold text-2xl text-foreground">{goal.title}</Text>
          {goal.description ? <Text variant="muted">{goal.description}</Text> : null}
          <View className="mt-1 flex-row items-center gap-3">
            <View className="flex-row items-center gap-1.5">
              <View
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: goalPriorityColor(goal.priority) }}
              />
              <Text variant="caption">
                {t('goals.priorityLabel', { priority: t(`fields.${goal.priority}`) })}
              </Text>
            </View>
            {due && (
              <Text
                variant="caption"
                className={
                  due.state === 'later'
                    ? undefined
                    : due.state === 'overdue'
                      ? 'text-destructive'
                      : 'text-warning'
                }
              >
                {due.label}
              </Text>
            )}
          </View>
        </View>

        {/* Completed banner + reopen */}
        {isCompleted && (
          <View className={cardClass({ padding: 'md', elevation: 'e1' }, 'gap-3')}>
            <View className="flex-row items-center gap-2">
              <Check size={18} color={dsColors[scheme].success} />
              <Text className="font-sora-semibold text-foreground">
                {goal.completedAt
                  ? t('goals.completedOn', { date: format(goal.completedAt, 'MMM d, yyyy') })
                  : t('goals.completed')}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={() => mutations.reopen.mutate(goal.id)}
              className="flex-row items-center justify-center gap-1.5 rounded-xl border border-border py-3"
            >
              <RotateCcw size={16} color={colors[scheme].foreground} />
              <Text className="font-sora-medium">{t('goals.reopenGoal')}</Text>
            </Pressable>
          </View>
        )}

        {/* Primary action: log progress (percent/count, active only) */}
        {!isCompleted && !isMilestones && (
          <GradientButton
            label={t('goals.logProgress')}
            tint={meta.tint}
            icon={Plus}
            onPress={() => router.push(`/goals/${goal.id}/log`)}
          />
        )}

        {/* Progress chart — shown for active and completed goals so the history
            stays visible after finishing. */}
        {showChart && (
          <View className={cardClass({ padding: 'md', elevation: 'e1' }, 'gap-3')}>
            <View className="flex-row items-center justify-between">
              <Text variant="subheading">{t('goals.progressOverTime')}</Text>
              {timeline.hasDeadline && !isCompleted && (
                <View className="flex-row items-center gap-1.5">
                  <View
                    className="h-0.5 w-4"
                    style={{ backgroundColor: colors[scheme].mutedForeground }}
                  />
                  <Text variant="caption">{t('goals.expected')}</Text>
                </View>
              )}
            </View>
            <LineChart
              series={series}
              color={meta.tint}
              rangeStart={goal.createdAt}
              rangeEnd={rangeEnd}
              showExpected={timeline.hasDeadline && !isCompleted}
              height={150}
            />
            {!isCompleted && timeline.requiredPerDay !== null && timeline.pace === 'behind' && (
              <View
                className="flex-row items-center gap-1.5 rounded-xl px-3 py-2"
                style={{ backgroundColor: alpha(dsColors[scheme].warning, 0.12) }}
              >
                <TrendingUp size={14} color={dsColors[scheme].warning} />
                <Text variant="caption" className="text-warning">
                  {t('goals.aimPerDay', {
                    percent: Math.max(1, Math.round(timeline.requiredPerDay * 100)),
                  })}
                </Text>
              </View>
            )}
          </View>
        )}

        {/* Milestones */}
        {isMilestones && (
          <View className="gap-3">
            <Text variant="subheading">{t('goals.milestones')}</Text>
            <MilestoneTimeline
              milestones={milestones}
              tint={meta.tint}
              onToggle={(m) =>
                mutations.toggleMilestone.mutate({ id: m.id, isCompleted: !m.isCompleted })
              }
              onAdd={(title) => mutations.addMilestone.mutate({ goalId: goal.id, title })}
              onRemove={(m) => mutations.removeMilestone.mutate(m.id)}
            />
          </View>
        )}

        {/* Activity feed */}
        {!isMilestones && activity.length > 0 && (
          <View className="gap-3">
            <SectionHeader title={t('goals.activity')} />
            <View className="gap-2.5">
              {activity.map((log) => (
                <Pressable
                  key={log.id}
                  onLongPress={() => mutations.removeProgressLog.mutate(log.id)}
                  className={cardClass(
                    { padding: 'sm', elevation: 'e1' },
                    'flex-row items-center gap-3',
                  )}
                  accessibilityHint={t('goals.longPressDeleteUpdate')}
                >
                  <View
                    className="h-9 w-9 items-center justify-center rounded-full"
                    style={{ backgroundColor: alpha(meta.tint, 0.15) }}
                  >
                    <TrendingUp size={16} color={meta.tint} />
                  </View>
                  <View className="flex-1 gap-0.5">
                    <Text className="font-sora-medium text-foreground">
                      {log.note?.trim() || t('goals.progressUpdate')}
                    </Text>
                    <Text variant="caption">{format(log.loggedAt, 'EEE, MMM d · h:mm a')}</Text>
                  </View>
                  <View
                    className="rounded-full px-2.5 py-1"
                    style={{
                      backgroundColor: alpha(
                        log.delta >= 0 ? dsColors[scheme].success : dsColors[scheme].error,
                        0.14,
                      ),
                    }}
                  >
                    <Text
                      className="font-sora-bold"
                      style={{
                        color: log.delta >= 0 ? dsColors[scheme].success : dsColors[scheme].error,
                        fontSize: 12,
                      }}
                    >
                      {formatDelta(log.delta)}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {/* Complete (active only) */}
        {!isCompleted &&
          (readyToComplete ? (
            <GradientButton
              label={t('goals.completeGoal')}
              tint={dsColors[scheme].success}
              icon={Check}
              onPress={handleComplete}
            />
          ) : (
            <Pressable
              accessibilityRole="button"
              onPress={handleComplete}
              className="flex-row items-center justify-center gap-2 rounded-2xl border border-border py-4"
            >
              <Check size={18} color={colors[scheme].foreground} />
              <Text className="font-sora-semibold text-foreground">{t('goals.markComplete')}</Text>
            </Pressable>
          ))}
      </ScrollView>

      <CelebrationOverlay visible={celebrate} onDone={() => setCelebrate(false)} />
    </View>
  );
}
