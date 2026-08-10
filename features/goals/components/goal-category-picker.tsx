import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, TextInput, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { colors } from '@/constants/theme';
import { GOAL_CATEGORIES } from '@/features/goals/config/goal-categories';
import { resolveTint } from '@/constants/design-tokens';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { GoalCategory } from '@/features/goals/types/goal.types';
import { cn } from '@/lib/utils';

type Props = {
  value: GoalCategory;
  customLabel: string | null;
  onChange: (category: GoalCategory) => void;
  onChangeLabel: (label: string | null) => void;
};

export function GoalCategoryPicker({ value, customLabel, onChange, onChangeLabel }: Props) {
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();

  const select = (category: GoalCategory) => {
    Haptics.selectionAsync();
    onChange(category);
  };

  return (
    <View className="gap-2.5">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerClassName="items-center gap-2"
      >
        {GOAL_CATEGORIES.map((category) => {
          const selected = category.id === value;
          const Icon = category.icon;
          const tint = resolveTint(category.tint, scheme);
          return (
            <Pressable
              accessibilityRole="button"
              key={category.id}
              onPress={() => select(category.id)}
              style={selected ? { backgroundColor: tint, borderColor: tint } : undefined}
              className={cn(
                'flex-row items-center gap-1.5 rounded-full border px-3 py-1.5',
                !selected && 'border-border',
              )}
            >
              <Icon size={14} color={selected ? '#ffffff' : tint} strokeWidth={2.2} />
              <Text className={selected ? 'font-sora-medium text-white' : 'text-muted-foreground'}>
                {t(category.labelKey)}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {value === 'custom' && (
        <TextInput
          value={customLabel ?? ''}
          onChangeText={(text) => onChangeLabel(text || null)}
          accessibilityLabel={t('category.name')}
          placeholder={t('goals.categoryPlaceholder')}
          placeholderTextColor={colors[scheme].mutedForeground}
          maxLength={30}
          className="rounded-lg border border-border px-3 py-2 text-foreground"
        />
      )}
    </View>
  );
}
