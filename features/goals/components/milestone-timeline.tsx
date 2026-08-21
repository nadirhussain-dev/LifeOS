import * as Haptics from 'expo-haptics';
import { format } from 'date-fns';
import { Check, Plus } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useReducedMotion } from '@/hooks/use-reduced-motion';

import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { GoalMilestone } from '@/features/goals/types/goal.types';

type Props = {
  milestones: GoalMilestone[];
  tint: string;
  onToggle: (milestone: GoalMilestone) => void;
  onAdd: (title: string) => void;
  onRemove: (milestone: GoalMilestone) => void;
};

/**
 * Vertical milestone timeline for the goal detail screen. A connector line
 * threads the checkpoints; completed ones fill with the goal's tint. Tapping a
 * node toggles it (with haptic), and a persistent composer row appends new
 * checkpoints inline.
 */
export function MilestoneTimeline({ milestones, tint, onToggle, onAdd, onRemove }: Props) {
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const reducedMotion = useReducedMotion();
  const [draft, setDraft] = useState('');

  const submitDraft = () => {
    const trimmed = draft.trim();
    if (trimmed) onAdd(trimmed);
    setDraft('');
  };

  return (
    <View className="gap-1">
      {milestones.map((milestone, index) => {
        const isLast = index === milestones.length - 1;
        return (
          <Animated.View
            key={milestone.id}
            entering={reducedMotion ? undefined : FadeIn}
            className="flex-row gap-3"
          >
            <View className="items-center">
              <Pressable
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  onToggle(milestone);
                }}
                hitSlop={6}
                className="h-6 w-6 items-center justify-center rounded-full border-2"
                style={{
                  borderColor: milestone.isCompleted ? tint : colors[scheme].border,
                  backgroundColor: milestone.isCompleted ? tint : 'transparent',
                }}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: milestone.isCompleted }}
                accessibilityLabel={milestone.title}
              >
                {milestone.isCompleted && <Check size={14} color="#ffffff" strokeWidth={3} />}
              </Pressable>
              {!isLast && (
                <View
                  className="my-0.5 w-0.5 flex-1"
                  style={{ backgroundColor: colors[scheme].border }}
                />
              )}
            </View>

            <Pressable
              onLongPress={() => onRemove(milestone)}
              className="flex-1 pb-4"
              accessibilityHint={t('goals.longPressDelete')}
            >
              <Text
                className={
                  milestone.isCompleted
                    ? 'font-sora-medium text-muted-foreground line-through'
                    : 'font-sora-medium'
                }
              >
                {milestone.title}
              </Text>
              {milestone.isCompleted && milestone.completedAt && (
                <Text variant="caption">
                  {t('goals.doneOn', { date: format(milestone.completedAt, 'MMM d') })}
                </Text>
              )}
            </Pressable>
          </Animated.View>
        );
      })}

      <View className="flex-row items-center gap-3">
        <View
          className="h-6 w-6 items-center justify-center rounded-full border-2 border-dashed"
          style={{ borderColor: colors[scheme].border }}
        >
          <Plus size={13} color={colors[scheme].mutedForeground} />
        </View>
        <Input
          surface="bare"
          value={draft}
          onChangeText={setDraft}
          placeholder={t('goals.addAMilestone')}
          onSubmitEditing={submitDraft}
          returnKeyType="done"
          className="flex-1 py-1 text-foreground"
        />
      </View>
    </View>
  );
}
