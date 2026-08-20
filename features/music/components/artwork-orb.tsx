import { LinearGradient } from 'expo-linear-gradient';
import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { songColor, songGradient } from '@/features/music/utils/song-art';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { alpha, glowShadow } from '@/lib/color';

type Props = {
  seed: string;
  size: number;
  playing: boolean;
};

/**
 * The song's "artwork": a glossy generative-gradient orb. A diagonal highlight
 * sweeps slowly around it and the whole disc gently breathes while playing, then
 * settles when paused — the living centerpiece of Now Playing.
 *
 * Under reduced motion the orb keeps its gradient and glow and simply stops
 * moving: the sheen holds at a fixed angle and the disc at rest scale. The two
 * loops here ran indefinitely (a 2.6s breath and a 16s rotation), which is the
 * category the setting exists for.
 */
export function ArtworkOrb({ seed, size, playing }: Props) {
  const [c1, c2, c3] = songGradient(seed);
  const glowColor = songColor(seed);

  const breathe = useSharedValue(1);
  const spin = useSharedValue(0);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (playing && reducedMotion) {
      cancelAnimation(breathe);
      cancelAnimation(spin);
      breathe.value = 1;
      // A quarter turn, so the highlight reads as lighting from one side rather
      // than as a sheen that happens to be parked at twelve o'clock.
      spin.value = 0.25;
    } else if (playing) {
      breathe.value = withRepeat(
        withTiming(1.045, { duration: 2600, easing: Easing.inOut(Easing.sin) }),
        -1,
        true,
      );
      spin.value = withRepeat(withTiming(1, { duration: 16000, easing: Easing.linear }), -1, false);
    } else {
      cancelAnimation(breathe);
      cancelAnimation(spin);
      breathe.value = withTiming(1, { duration: 420 });
    }
    return () => {
      cancelAnimation(breathe);
      cancelAnimation(spin);
    };
  }, [playing, breathe, spin, reducedMotion]);

  const orbStyle = useAnimatedStyle(() => ({ transform: [{ scale: breathe.value }] }));
  const sheenStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${spin.value * 360}deg` }],
  }));

  return (
    <Animated.View
      style={[
        { width: size, height: size, borderRadius: size / 2 },
        glowShadow(glowColor, 0.55),
        orbStyle,
      ]}
    >
      <View style={{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden' }}>
        <LinearGradient
          colors={[c1, c2, c3]}
          start={{ x: 0.1, y: 0.1 }}
          end={{ x: 0.9, y: 0.9 }}
          style={{ flex: 1 }}
        />

        {/* Rotating diagonal sheen */}
        <Animated.View style={[{ position: 'absolute', width: size, height: size }, sheenStyle]}>
          <LinearGradient
            colors={[alpha('#ffffff', 0.34), 'transparent', 'transparent', alpha('#000000', 0.22)]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ flex: 1 }}
          />
        </Animated.View>

        {/* Inner rim for depth */}
        <View
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: size / 2,
            borderWidth: 1,
            borderColor: alpha('#ffffff', 0.18),
          }}
        />
      </View>
    </Animated.View>
  );
}
