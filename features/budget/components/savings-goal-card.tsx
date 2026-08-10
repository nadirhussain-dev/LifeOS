import { format } from 'date-fns';
import { Plus } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { cardClass } from '@/components/ui/card';
import { ProgressBar } from '@/components/ui/progress-bar';
import { Text } from '@/components/ui/text';
import { formatMoney } from '@/features/budget/services/money';
import type { SavingsGoalWithProgress } from '@/features/budget/types/budget.types';

type Props = {
  goal: SavingsGoalWithProgress;
  currency: string;
  onPress: (goal: SavingsGoalWithProgress) => void;
  onAdd: (goal: SavingsGoalWithProgress) => void;
};

export function SavingsGoalCard({ goal, currency, onPress, onAdd }: Props) {
  const complete = goal.progress >= 1;

  return (
    <Pressable
      onPress={() => onPress(goal)}
      className={cardClass({ padding: 'md', elevation: 'e1' }, 'gap-3')}
      accessibilityRole="button"
    >
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center gap-2">
          <View className="h-3 w-3 rounded-full" style={{ backgroundColor: goal.colorToken }} />
          <Text className="font-sora-semibold text-foreground">{goal.name}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={() => onAdd(goal)}
          hitSlop={8}
          className="h-8 w-8 items-center justify-center rounded-full"
          style={{ backgroundColor: goal.colorToken }}
          accessibilityLabel={`Add savings to ${goal.name}`}
        >
          <Plus size={16} color="#ffffff" />
        </Pressable>
      </View>

      <ProgressBar progress={goal.progress} color={goal.colorToken} height={8} />

      <View className="flex-row items-center justify-between">
        <Text variant="caption">
          <Text className="font-sora-semibold text-foreground">
            {formatMoney(goal.savedCents, currency)}
          </Text>{' '}
          of {formatMoney(goal.targetCents, currency)}
        </Text>
        <Text
          variant="caption"
          className={complete ? 'font-sora-semibold text-success' : 'font-sora-semibold'}
        >
          {complete
            ? 'Reached 🎉'
            : goal.deadline
              ? `by ${format(goal.deadline, 'MMM yyyy')}`
              : `${Math.round(goal.progress * 100)}%`}
        </Text>
      </View>
    </Pressable>
  );
}
