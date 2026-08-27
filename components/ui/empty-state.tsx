import { useEffect } from 'react';
import { View } from 'react-native';
import { type LucideIcon } from '@/components/ui/icons';
import { useColorScheme } from '@/hooks/use-color-scheme';
import Animated, {
  FadeIn,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
} from 'react-native-reanimated';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { colors } from '@/constants/theme';
import { useReducedMotion } from '@/hooks/use-reduced-motion';

type Props = {
  icon: LucideIcon;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  /** Hex tint for the icon's circular backdrop — defaults to the brand accent. */
  tint?: string;
};

export function EmptyState({ icon: Icon, title, description, actionLabel, onAction, tint }: Props) {
  const scheme = useColorScheme() ?? 'light';
  const reducedMotion = useReducedMotion();
  const scale = useSharedValue(reducedMotion ? 1 : 0.7);

  useEffect(() => {
    if (reducedMotion) {
      scale.value = 1;
      return;
    }
    scale.value = withDelay(80, withSpring(1, { damping: 11, stiffness: 140 }));
  }, [scale, reducedMotion]);

  const iconStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const tintColor = tint ?? colors[scheme].accent;

  return (
    <View className="flex-1 items-center justify-center gap-3 px-10">
      <Animated.View style={iconStyle}>
        <View
          className="h-16 w-16 items-center justify-center rounded-full"
          style={{ backgroundColor: `${tintColor}1a` }}
        >
          <Icon color={tintColor} size={28} strokeWidth={1.75} />
        </View>
      </Animated.View>
      <Animated.View
        entering={reducedMotion ? undefined : FadeIn.delay(120).duration(300)}
        className="items-center gap-2"
      >
        <Text variant="heading" className="text-center">
          {title}
        </Text>
        <Text variant="muted" className="text-center">
          {description}
        </Text>
        {actionLabel && onAction && (
          <Button
            label={actionLabel}
            onPress={onAction}
            variant="accent"
            size="sm"
            className="mt-2"
          />
        )}
      </Animated.View>
    </View>
  );
}
