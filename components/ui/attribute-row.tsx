import { type LucideIcon } from 'lucide-react-native';
import { type ReactNode } from 'react';
import { View } from 'react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';

import { Text } from '@/components/ui/text';
import { colors } from '@/constants/theme';

type Props = {
  icon: LucideIcon;
  label: string;
  isFirst?: boolean;
  children: ReactNode;
};

/** One icon-led property section within an attribute card (priority, due date, category). */
export function AttributeRow({ icon: Icon, label, isFirst, children }: Props) {
  const scheme = useColorScheme() ?? 'light';

  return (
    <View className={isFirst ? 'gap-2.5 py-3.5' : 'gap-2.5 border-t border-border py-3.5'}>
      <View className="flex-row items-center gap-1.5">
        <Icon size={13} color={colors[scheme].mutedForeground} />
        <Text variant="sectionLabel">{label}</Text>
      </View>
      {children}
    </View>
  );
}
