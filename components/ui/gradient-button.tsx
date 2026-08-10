import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { type LucideIcon } from 'lucide-react-native';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { Text } from '@/components/ui/text';
import { glowShadow, tintGradient } from '@/lib/color';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type Props = {
  label: string;
  onPress: () => void;
  /** Gradient + glow derive from this tint. */
  tint: string;
  icon?: LucideIcon;
  disabled?: boolean;
  /** Compact height for inline placement. */
  size?: 'md' | 'lg';
};

/**
 * Signature CTA of the premium language: a pill filled with the module's tint
 * gradient, a soft glow, spring press, and light haptic — the tactile
 * counterpart to a module's HeroCard. Replaces flat `backgroundColor: tint`
 * buttons so every primary action reads as the same elevated surface.
 */
export function GradientButton({ label, onPress, tint, icon: Icon, disabled, size = 'lg' }: Props) {
  const scale = useSharedValue(1);
  const [start, end] = tintGradient(tint);
  // White is safe on any tintGradient: the gradient darkens itself until it is.
  const ink = '#ffffff';
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const height = size === 'lg' ? 56 : 46;

  return (
    <AnimatedPressable
      onPress={() => {
        if (disabled) return;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        onPress();
      }}
      onPressIn={() => (scale.value = withSpring(0.97, { damping: 15, stiffness: 400 }))}
      onPressOut={() => (scale.value = withSpring(1, { damping: 12, stiffness: 300 }))}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[
        style,
        { height, borderRadius: height / 2, opacity: disabled ? 0.5 : 1 },
        !disabled && glowShadow(tint, 0.4),
      ]}
    >
      <View style={{ flex: 1, borderRadius: height / 2, overflow: 'hidden' }}>
        <LinearGradient
          colors={[start, end]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <View
          style={{
            flex: 1,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
          }}
        >
          {Icon && <Icon size={size === 'lg' ? 20 : 17} color={ink} strokeWidth={2.4} />}
          <Text
            className="font-sora-bold"
            style={{ color: ink, fontSize: size === 'lg' ? 16 : 15 }}
          >
            {label}
          </Text>
        </View>
      </View>
    </AnimatedPressable>
  );
}
