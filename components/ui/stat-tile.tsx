import { type LucideIcon } from 'lucide-react-native';
import { View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useReducedMotion } from '@/hooks/use-reduced-motion';

import { cardClass } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { alpha } from '@/lib/color';

type Props = {
  icon: LucideIcon;
  value: string;
  label: string;
  tint: string;
  /** Stagger index for the entrance animation when rendered in a row. */
  index?: number;
};

/**
 * Premium stat tile: a tinted icon chip over a big value and caption, on a
 * card with a hairline border. Enters with a small staggered rise. Shared by
 * every module's stat row so the dashboards read as one system.
 */
export function StatTile({ icon: Icon, value, label, tint, index = 0 }: Props) {
  const reducedMotion = useReducedMotion();
  return (
    <Animated.View
      entering={reducedMotion ? undefined : FadeInDown.delay(index * 60).duration(320)}
      className={cardClass({ padding: 'none' }, 'flex-1 items-center gap-2 py-4')}
    >
      <View
        className="h-9 w-9 items-center justify-center rounded-full"
        style={{ backgroundColor: alpha(tint, 0.15) }}
      >
        <Icon size={17} color={tint} strokeWidth={2.2} />
      </View>
      <Text className="font-sora-extrabold text-lg text-foreground">{value}</Text>
      <Text variant="caption" numberOfLines={1} style={{ fontSize: 10.5 }}>
        {label}
      </Text>
    </Animated.View>
  );
}
