import { GripVertical, Plus, X } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

type Props = {
  value: string[];
  onChange: (milestones: string[]) => void;
};

/** Lightweight editor for the goal form — a growable list of milestone titles.
 * Order is meaningful (it becomes each milestone's position), so new rows
 * append to the end. */
export function MilestoneEditor({ value, onChange }: Props) {
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();

  const setAt = (index: number, text: string) => {
    const next = [...value];
    next[index] = text;
    onChange(next);
  };

  const removeAt = (index: number) => onChange(value.filter((_, i) => i !== index));
  const add = () => onChange([...value, '']);

  return (
    <View className="gap-2">
      {value.map((milestone, index) => (
        <View
          key={index}
          className="flex-row items-center gap-2 rounded-lg border border-border px-2.5 py-1.5"
        >
          <GripVertical size={15} color={colors[scheme].mutedForeground} />
          <Input
            surface="bare"
            value={milestone}
            onChangeText={(text) => setAt(index, text)}
            accessibilityLabel={t('goals.milestoneN', { index: index + 1 })}
            placeholder={t('goals.milestoneN', { index: index + 1 })}
            className="flex-1 py-1 text-foreground"
            maxLength={100}
          />
          <Pressable accessibilityRole="button" onPress={() => removeAt(index)} hitSlop={8}>
            <X size={16} color={colors[scheme].mutedForeground} />
          </Pressable>
        </View>
      ))}

      <Pressable
        accessibilityRole="button"
        onPress={add}
        className="flex-row items-center justify-center gap-1.5 rounded-lg border border-dashed border-border py-2.5"
      >
        <Plus size={15} color={colors[scheme].accent} />
        <Text className="font-sora-medium" style={{ color: colors[scheme].accent }}>
          {t('goals.addMilestone')}
        </Text>
      </Pressable>
    </View>
  );
}
