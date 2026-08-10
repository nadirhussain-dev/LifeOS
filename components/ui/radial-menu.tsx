import * as Haptics from 'expo-haptics';
import { type LucideIcon } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/text';
import { accentGradient, elevation, motion, opacity } from '@/constants/design-tokens';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { useTheme } from '@/hooks/use-theme';

export type RadialAction = {
  key: string;
  label: string;
  icon: LucideIcon;
  onPress: () => void;
};

type Props = {
  open: boolean;
  onClose: () => void;
  actions: RadialAction[];
  /** Distance from the anchor to each action's centre. */
  radius?: number;
  /** Where the arc sweeps from and to, in degrees. 180 = due left, 270 = up. */
  startAngle?: number;
  endAngle?: number;
};

const ITEM = 52;

/** The FAB is 56 across, inset 20 from the trailing edge and from the bottom
 *  safe area — so its centre sits 48 in from the trailing edge and 48 above
 *  the bottom inset. The arc has to use the same anchor or it fans out from a
 *  point that isn't the button you pressed. */
const FAB_CENTRE = 48;

/** Each item leaves a beat after the one before it. Small enough to read as one
 *  gesture, large enough that the arc unrolls rather than appearing. */
const STAGGER_MS = 35;

/**
 * A quarter-arc of actions that fans out from a fixed anchor.
 *
 * The FAB is kept as the thing you can see — an app whose only way to create
 * something is an undiscoverable long-press is a worse app, whatever it looks
 * like. Tapping still opens the full sheet. Long-pressing fans the same
 * actions out under the thumb, which is the faster path once you know it is
 * there, and reaching them costs one gesture instead of tap-wait-read-tap.
 *
 * The arc sweeps up and to the left because the FAB sits at the trailing
 * bottom corner, so that is the only quadrant with room, and it is where a
 * right thumb already is. `insetInlineEnd` on the FAB means it flips in RTL;
 * the arc is positioned relative to the same anchor and flips with it.
 */
export function RadialMenu({
  open,
  onClose,
  actions,
  radius = 108,
  startAngle = 182,
  endAngle = 268,
}: Props) {
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const progress = useSharedValue(0);

  // Kept in React state rather than read off `progress` during render: reading
  // a shared value in a render body is not reactive, so the close animation
  // would never trigger the re-render that unmounts the arc, and the scrim
  // would stay mounted for the life of the screen.
  const [mounted, setMounted] = useState(open);

  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);

  useEffect(() => {
    if (reducedMotion) {
      progress.value = open ? 1 : 0;
      if (!open) setMounted(false);
      return;
    }
    progress.value = open
      ? withSpring(1, motion.spring.gentle)
      : withTiming(0, { duration: motion.duration.fast }, (finished) => {
          if (finished) runOnJS(setMounted)(false);
        });
  }, [open, progress, reducedMotion]);

  const scrim = useAnimatedStyle(() => ({
    opacity: progress.value * opacity.scrim,
  }));

  if (!mounted) return null;

  const step = actions.length > 1 ? (endAngle - startAngle) / (actions.length - 1) : 0;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={open ? 'auto' : 'none'}>
      {/* Tapping anywhere dismisses. A radial menu with no way out except the
          exact button you opened it with is a trap on a phone. Labelled,
          because to a screen reader this is otherwise a button the size of the
          display with nothing to say for itself. */}
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close quick actions"
      >
        <Animated.View style={[StyleSheet.absoluteFill, scrim, { backgroundColor: '#000' }]} />
      </Pressable>

      {actions.map((action, index) => (
        <RadialItem
          key={action.key}
          action={action}
          angle={startAngle + step * index}
          radius={radius}
          bottomInset={insets.bottom}
          open={open}
          // Nearest the thumb leads, so the arc unrolls away from the hand
          // instead of arriving at it.
          delay={index * STAGGER_MS}
          onClose={onClose}
        />
      ))}
    </View>
  );
}

function RadialItem({
  action,
  angle,
  radius,
  bottomInset,
  open,
  delay,
  onClose,
}: {
  action: RadialAction;
  angle: number;
  radius: number;
  bottomInset: number;
  open: boolean;
  delay: number;
  onClose: () => void;
}) {
  const { c } = useTheme();
  const reducedMotion = useReducedMotion();
  const progress = useSharedValue(0);

  const radians = (angle * Math.PI) / 180;
  const dx = Math.cos(radians) * radius;
  const dy = Math.sin(radians) * radius;

  useEffect(() => {
    if (reducedMotion) {
      progress.value = open ? 1 : 0;
      return;
    }
    progress.value = open
      ? withDelay(delay, withSpring(1, motion.spring.gentle))
      : // Closing is not staggered. A menu you have dismissed should be gone,
        // not rolling itself up while you wait.
        withTiming(0, { duration: motion.duration.fast });
  }, [open, delay, progress, reducedMotion]);

  const style = useAnimatedStyle(() => {
    const p = progress.value;
    return {
      opacity: p,
      transform: [{ translateX: dx * p }, { translateY: dy * p }, { scale: 0.6 + 0.4 * p }],
    };
  });

  const [start] = accentGradient;

  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          insetInlineEnd: FAB_CENTRE - ITEM / 2,
          bottom: bottomInset + FAB_CENTRE - ITEM / 2,
          alignItems: 'center',
        },
        style,
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={action.label}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          onClose();
          action.onPress();
        }}
        style={[
          {
            height: ITEM,
            width: ITEM,
            borderRadius: ITEM / 2,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: c.card,
            borderWidth: 1,
            borderColor: c.border,
          },
          elevation.e3,
        ]}
      >
        <action.icon size={22} color={start} strokeWidth={2.2} />
      </Pressable>
      {/* Labelled, because an unlabelled ring of icons is a memory test. The
          label is decoration for a screen reader — the button above already
          announces it — so it is hidden from the accessibility tree. */}
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{
          marginTop: 6,
          borderRadius: 999,
          paddingHorizontal: 8,
          paddingVertical: 2,
          backgroundColor: c.card,
          borderWidth: 1,
          borderColor: c.border,
        }}
      >
        <Text variant="caption" numberOfLines={1} style={{ color: c.foreground, fontSize: 10.5 }}>
          {action.label}
        </Text>
      </View>
    </Animated.View>
  );
}
