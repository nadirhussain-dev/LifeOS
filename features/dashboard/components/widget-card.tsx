import { type LucideIcon } from 'lucide-react-native';
import { Pressable, View } from 'react-native';
import { useTheme } from '@/hooks/use-theme';

import { cardClass } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { alpha } from '@/lib/color';

type Props = {
  icon: LucideIcon;
  title: string;
  actionLabel?: string;
  onActionPress?: () => void;
  /** Optional accent for the icon chip + action — defaults to the brand accent. */
  tint?: string;
  children: React.ReactNode;
};

export function WidgetCard({
  icon: Icon,
  title,
  actionLabel,
  onActionPress,
  tint,
  children,
}: Props) {
  const { c } = useTheme();
  const accent = tint ?? c.accent;

  return (
    <View className={cardClass({ padding: 'md', elevation: 'e1' }, 'gap-3')}>
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center gap-2.5">
          <View
            className="h-8 w-8 items-center justify-center rounded-xl"
            style={{ backgroundColor: alpha(accent, 0.14) }}
          >
            <Icon color={accent} size={17} />
          </View>
          <Text variant="subheading">{title}</Text>
        </View>
        {actionLabel && onActionPress ? (
          <Pressable accessibilityRole="button" onPress={onActionPress} hitSlop={8}>
            <Text variant="caption" className="font-sora-semibold" style={{ color: accent }}>
              {actionLabel}
            </Text>
          </Pressable>
        ) : null}
      </View>
      {children}
    </View>
  );
}
