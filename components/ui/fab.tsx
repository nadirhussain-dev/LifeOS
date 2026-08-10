import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { Plus } from 'lucide-react-native';
import { Pressable, StyleSheet } from 'react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { accentGradient } from '@/constants/design-tokens';
import { colors } from '@/constants/theme';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type Props = {
  onPress: () => void;
  /**
   * Fans the same actions out in an arc under the thumb instead of opening the
   * sheet. Optional: without it the FAB behaves exactly as it always has.
   */
  onLongPress?: () => void;
  accessibilityLabel?: string;
};

export function Fab({ onPress, onLongPress, accessibilityLabel = 'Quick actions' }: Props) {
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme() ?? 'light';
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <AnimatedPressable
      onPress={onPress}
      onLongPress={
        onLongPress &&
        (() => {
          // Heavier than a tap: the gesture does more, and the haptic is the
          // only thing that tells you the long-press registered before the
          // arc has finished animating out.
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          onLongPress();
        })
      }
      delayLongPress={220}
      onPressIn={() => {
        scale.value = withTiming(0.92, { duration: 100 });
      }}
      onPressOut={() => {
        scale.value = withTiming(1, { duration: 100 });
      }}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      style={[
        animatedStyle,
        {
          position: 'absolute',
          // Trailing edge, so the FAB moves to the bottom-left in RTL.
          insetInlineEnd: 20,
          bottom: insets.bottom + 20,
          height: 56,
          width: 56,
          borderRadius: 28,
          overflow: 'hidden',
          alignItems: 'center',
          justifyContent: 'center',
          shadowColor: colors[scheme].accent,
          shadowOpacity: 0.4,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 5 },
          elevation: 5,
        },
      ]}
    >
      <LinearGradient
        colors={accentGradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />
      <Plus color={colors[scheme].accentForeground} size={26} />
    </AnimatedPressable>
  );
}
