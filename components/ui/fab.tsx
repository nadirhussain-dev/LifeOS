import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { Plus, type LucideIcon } from 'lucide-react-native';
import { Pressable, StyleSheet } from 'react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/text';
import { accentGradient } from '@/constants/design-tokens';
import { colors } from '@/constants/theme';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** The circular FAB's diameter. RadialMenu derives its arc anchor from this
 *  (see FAB_CENTRE there), so the two have to agree. */
const SIZE = 56;

type Props = {
  onPress: () => void;
  /**
   * Fans the same actions out in an arc under the thumb instead of opening the
   * sheet. Optional: without it the FAB behaves exactly as it always has.
   */
  onLongPress?: () => void;
  accessibilityLabel?: string;
  /**
   * The glyph. Defaults to a plus, which is right for every screen whose FAB
   * creates something — and wrong for the ones whose FAB does not.
   */
  icon?: LucideIcon;
  /**
   * Turns the button into an extended FAB: a pill with the label beside the
   * icon instead of a bare circle.
   *
   * For the FAB whose action isn't "new thing". A plus is legible without a
   * label because there is only one thing a plus can mean; an icon standing for
   * "choose which modules you use" is not, and a circle with a slider glyph in
   * it is a guessing game. The label costs width on a screen that has it —
   * a scrolling grid, not a full-bleed list — and buys the gesture being
   * understood before it is pressed rather than after.
   *
   * Note the extended FAB is not a valid anchor for `RadialMenu`, whose arc
   * geometry assumes the 56pt circle. Nothing pairs them today; don't.
   */
  label?: string;
};

export function Fab({
  onPress,
  onLongPress,
  accessibilityLabel = 'Quick actions',
  icon: Icon = Plus,
  label,
}: Props) {
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme() ?? 'light';
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const extended = !!label;

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
          height: SIZE,
          // A pill wide enough for its label, a circle otherwise. The radius is
          // half the height either way, so both read as one shape family.
          width: extended ? undefined : SIZE,
          paddingHorizontal: extended ? 20 : 0,
          borderRadius: SIZE / 2,
          overflow: 'hidden',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: extended ? 8 : 0,
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
      <Icon color={colors[scheme].accentForeground} size={extended ? 20 : 26} strokeWidth={2.2} />
      {extended ? (
        <Text
          className="font-sora-semibold"
          style={{ color: colors[scheme].accentForeground, fontSize: 15 }}
          numberOfLines={1}
        >
          {label}
        </Text>
      ) : null}
    </AnimatedPressable>
  );
}
