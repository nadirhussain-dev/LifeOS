import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { colors } from '@/constants/theme';
import { useLinkableGoals } from '@/features/goals/hooks/use-goals';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { cn } from '@/lib/utils';

type Props = {
  value: string | null;
  onChange: (goalId: string | null) => void;
};

/**
 * Picks the goal a task or habit advances.
 *
 * Only count-mode goals are offered, because they are the only ones a
 * contribution can honestly move — see `goal-contributions.ts`. Filtering here
 * rather than accepting any goal and ignoring most is the difference between a
 * rule the user can see and a link that silently does nothing.
 *
 * Each option carries the goal's unit, since nothing checks that a habit
 * measuring minutes is being added to a goal counting kilometres. The person
 * making the link is the only one who can judge that, so they are shown what
 * they are adding to.
 */
export function GoalLinkPicker({ value, onChange }: Props) {
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const { data: linkable = [] } = useLinkableGoals();

  if (linkable.length === 0) {
    return <Text variant="muted">{t('goals.noCountGoals')}</Text>;
  }

  const option = (id: string | null, label: string, selected: boolean) => (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      key={id ?? 'none'}
      onPress={() => {
        Haptics.selectionAsync();
        onChange(id);
      }}
      style={
        selected
          ? { backgroundColor: colors[scheme].accent, borderColor: colors[scheme].accent }
          : undefined
      }
      className={cn('rounded-full border px-3 py-1.5', !selected && 'border-border')}
    >
      <Text
        className={cn('font-sora-medium', !selected && 'text-muted-foreground')}
        style={selected ? { color: colors[scheme].accentForeground } : undefined}
      >
        {label}
      </Text>
    </Pressable>
  );

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerClassName="items-center gap-2"
    >
      <View className="flex-row items-center gap-2">
        {option(null, t('fields.none'), value === null)}
        {linkable.map((goal) =>
          option(
            goal.id,
            goal.unit ? `${goal.title} (${goal.unit})` : goal.title,
            goal.id === value,
          ),
        )}
      </View>
    </ScrollView>
  );
}
