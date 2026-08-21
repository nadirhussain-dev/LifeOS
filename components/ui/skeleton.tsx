import { useEffect } from 'react';
import { View, type ViewProps } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { cn } from '@/lib/utils';

/**
 * A loading placeholder.
 *
 * The pulse is gated: it is the one animation in the app that a waiting user
 * stares directly at, for as long as the wait lasts, and it loops indefinitely.
 * Reduced motion holds it at a flat mid-opacity — still legible as "not content
 * yet", with nothing moving.
 */
export function Skeleton({ className, ...props }: ViewProps & { className?: string }) {
  const opacity = useSharedValue(0.5);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (reducedMotion) {
      opacity.value = 0.75;
      return;
    }
    opacity.value = withRepeat(withTiming(1, { duration: 700 }), -1, true);
  }, [opacity, reducedMotion]);

  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View style={style}>
      <View className={cn('rounded-md bg-muted', className)} {...props} />
    </Animated.View>
  );
}
