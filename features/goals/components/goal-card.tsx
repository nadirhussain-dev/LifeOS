import { CheckCircle2, Flag, ListChecks } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { cardClass } from '@/components/ui/card';
import { ProgressBar } from '@/components/ui/progress-bar';
import { Text } from '@/components/ui/text';
import { colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { goalCategoryLabel, goalCategoryMeta } from '@/features/goals/config/goal-categories';
import { goalPriorityColor } from '@/features/goals/config/goal-priority';
import { formatDueDate, formatProgressPercent } from '@/features/goals/services/goal-format';
import { goalTimeline } from '@/features/goals/services/goal-timeline';
import type { GoalWithProgress } from '@/features/goals/types/goal.types';
import { cn } from '@/lib/utils';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type Props = {
  goal: GoalWithProgress;
  onPress: (goal: GoalWithProgress) => void;
};

export function GoalCard({ goal, onPress }: Props) {
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const meta = goalCategoryMeta(goal.category, scheme);
  const Icon = meta.icon;
  const isCompleted = goal.status === 'completed';
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const due = goal.dueDate && !isCompleted ? formatDueDate(goal.dueDate, t) : null;
  const timeline = goalTimeline(goal, goal.progress);
  const showPaceTick = timeline.hasDeadline && !isCompleted;

  return (
    <AnimatedPressable
      onPress={() => onPress(goal)}
      onPressIn={() => (scale.value = withTiming(0.98, { duration: 90 }))}
      onPressOut={() => (scale.value = withTiming(1, { duration: 90 }))}
      style={animatedStyle}
      className={cardClass({ padding: 'md', elevation: 'e1' }, 'gap-3')}
      accessibilityRole="button"
      accessibilityLabel={goal.title}
    >
      <View className="flex-row items-center gap-3">
        <View
          className="h-10 w-10 items-center justify-center rounded-xl"
          style={{ backgroundColor: `${meta.tint}1f` }}
        >
          {isCompleted ? (
            <CheckCircle2 size={20} color={meta.tint} />
          ) : (
            <Icon size={20} color={meta.tint} strokeWidth={2} />
          )}
        </View>
        <View className="flex-1 gap-0.5">
          <Text
            className={cn(
              'font-sora-semibold text-base',
              isCompleted && 'text-muted-foreground line-through',
            )}
            numberOfLines={1}
          >
            {goal.title}
          </Text>
          <View className="flex-row items-center gap-1.5">
            <Text variant="caption" style={{ color: meta.tint }} className="font-sora-medium">
              {goalCategoryLabel(goal.category, goal.categoryLabel, t)}
            </Text>
            <View className="h-1 w-1 rounded-full bg-muted-foreground" />
            <Flag
              size={11}
              color={goalPriorityColor(goal.priority)}
              fill={goalPriorityColor(goal.priority)}
            />
            <Text variant="caption">{t(`fields.${goal.priority}`)}</Text>
          </View>
        </View>
        <Text className="font-sora-bold text-base" style={{ color: meta.tint }}>
          {formatProgressPercent(goal.progress)}
        </Text>
      </View>

      <View className="relative justify-center">
        <ProgressBar progress={goal.progress} color={meta.tint} height={7} />
        {showPaceTick && (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: `${timeline.expectedProgress * 100}%`,
              width: 2,
              height: 13,
              borderRadius: 1,
              backgroundColor: colors[scheme].foreground,
              opacity: 0.55,
            }}
          />
        )}
      </View>

      {(goal.milestoneTotal > 0 || due) && (
        <View className="flex-row items-center justify-between">
          {goal.milestoneTotal > 0 ? (
            <View className="flex-row items-center gap-1.5">
              <ListChecks size={12} color={colors[scheme].mutedForeground} />
              <Text variant="caption">
                {t('goals.milestonesProgress', {
                  done: goal.milestoneDone,
                  total: goal.milestoneTotal,
                })}
              </Text>
            </View>
          ) : (
            <View />
          )}
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
      )}
    </AnimatedPressable>
  );
}
