import { Pressable, View } from 'react-native';

import { Plus } from '@/components/ui/icons';
import { Text } from '@/components/ui/text';
import { colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

type Props = {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
};

export function WidgetEmptyState({ message, actionLabel, onAction }: Props) {
  const scheme = useColorScheme() ?? 'light';

  return (
    <View className="gap-2.5 py-1">
      <Text variant="muted">{message}</Text>
      {actionLabel && onAction ? (
        <Pressable
          onPress={onAction}
          className="flex-row items-center justify-center gap-2 rounded-2xl border border-dashed border-border py-3"
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
        >
          <Plus size={16} color={colors[scheme].accent} />
          <Text className="font-sora-semibold" style={{ color: colors[scheme].accent }}>
            {actionLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
