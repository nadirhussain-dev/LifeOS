import { View } from 'react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';

import { Text } from '@/components/ui/text';
import { colors } from '@/constants/theme';

type Props = {
  label: string;
  count: number;
  /** Small color dot before the label — e.g. red for "Overdue", accent for "Today". */
  dotColor?: string;
};

export function ListSectionHeader({ label, count, dotColor }: Props) {
  const scheme = useColorScheme() ?? 'light';

  return (
    <View className="flex-row items-center justify-between px-5 pb-2 pt-5">
      <View className="flex-row items-center gap-1.5">
        {dotColor && (
          <View className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: dotColor }} />
        )}
        <Text variant="sectionLabel">{label}</Text>
      </View>
      <View className="rounded-full bg-muted px-2 py-0.5">
        <Text
          variant="caption"
          className="font-sora-medium"
          style={{ color: colors[scheme].mutedForeground }}
        >
          {count}
        </Text>
      </View>
    </View>
  );
}
