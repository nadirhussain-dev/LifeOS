import { LinearGradient } from 'expo-linear-gradient';
import { useEffect } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { alpha, darken, lighten } from '@/lib/color';

/**
 * A slow, drifting aurora — three big soft color blobs over a near-black base —
 * tinted from the passed color. Full-screen and non-interactive; sits behind the
 * Now Playing content to make the whole screen feel lit by the current song.
 * (No blur dependency in the app, so softness comes from low-alpha overlap.)
 *
 * Reduced motion holds the three blobs at a resting position instead of
 * drifting. Static, not hidden: this is the only thing lighting the Now Playing
 * screen, and removing it leaves the controls on flat near-black. The setting
 * asks for no movement, not for no atmosphere.
 *
 * This was the loudest thing in the app ignoring that setting — three
 * full-screen layers on 11s/15s/19s loops, running indefinitely. The pass that
 * added the hook caught the celebratory bursts and missed the ambient loops,
 * which are worse: a burst ends on its own and an aurora does not.
 */
export function AuroraBackground({ color }: { color: string }) {
  const { width, height } = useWindowDimensions();
  const reducedMotion = useReducedMotion();
  const blob = Math.max(width, height) * 0.9;

  const a = useSharedValue(0);
  const b = useSharedValue(0);
  const c = useSharedValue(0);

  useEffect(() => {
    if (reducedMotion) {
      // Mid-drift, so the composition reads as deliberate rather than as the
      // first frame of an animation that never started.
      a.value = 0.5;
      b.value = 0.5;
      c.value = 0.5;
      return;
    }

    a.value = withRepeat(
      withTiming(1, { duration: 11000, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
    b.value = withRepeat(
      withTiming(1, { duration: 15000, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
    c.value = withRepeat(
      withTiming(1, { duration: 19000, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
  }, [a, b, c, reducedMotion]);

  const s1 = useAnimatedStyle(() => ({
    transform: [
      { translateX: -blob * 0.25 + a.value * blob * 0.3 },
      { translateY: -blob * 0.2 + a.value * blob * 0.25 },
      { scale: 1 + a.value * 0.12 },
    ],
  }));
  const s2 = useAnimatedStyle(() => ({
    transform: [
      { translateX: width - blob * 0.7 - b.value * blob * 0.25 },
      { translateY: height * 0.35 + b.value * blob * 0.2 },
      { scale: 1.1 - b.value * 0.15 },
    ],
  }));
  const s3 = useAnimatedStyle(() => ({
    transform: [
      { translateX: width * 0.2 + c.value * blob * 0.2 },
      { translateY: height - blob * 0.55 + c.value * blob * 0.15 },
      { scale: 0.9 + c.value * 0.2 },
    ],
  }));

  const circle = {
    position: 'absolute' as const,
    width: blob,
    height: blob,
    borderRadius: blob / 2,
  };

  return (
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFillObject, { backgroundColor: '#07070b', overflow: 'hidden' }]}
    >
      <Animated.View style={[circle, s1]}>
        <LinearGradient
          colors={[alpha(lighten(color, 0.2), 0.75), alpha(color, 0)]}
          style={{ flex: 1, borderRadius: blob / 2 }}
        />
      </Animated.View>
      <Animated.View style={[circle, s2]}>
        <LinearGradient
          colors={[alpha(color, 0.7), alpha(color, 0)]}
          style={{ flex: 1, borderRadius: blob / 2 }}
        />
      </Animated.View>
      <Animated.View style={[circle, s3]}>
        <LinearGradient
          colors={[alpha(darken(color, 0.1), 0.65), alpha(color, 0)]}
          style={{ flex: 1, borderRadius: blob / 2 }}
        />
      </Animated.View>
      {/* Vignette to keep controls legible */}
      <LinearGradient
        colors={['rgba(7,7,11,0.1)', 'rgba(7,7,11,0.72)']}
        style={StyleSheet.absoluteFillObject}
      />
    </Animated.View>
  );
}
