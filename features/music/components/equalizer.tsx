import { useEffect } from 'react';
import { View } from 'react-native';

import { useReducedMotion } from '@/hooks/use-reduced-motion';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

type BarProps = {
  color: string;
  width: number;
  minH: number;
  maxH: number;
  duration: number;
  delay: number;
  playing: boolean;
};

function Bar({ color, width, minH, maxH, duration, delay, playing }: BarProps) {
  const h = useSharedValue(minH);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (playing && reducedMotion) {
      /*
       * Held at this bar's own peak, not flattened to `minH`.
       *
       * Every bar carries a different `maxH`, so freezing each at its own peak
       * leaves the staggered silhouette of an equalizer caught mid-beat — which
       * still reads as "this is the one playing". Flat bars are what `playing:
       * false` looks like, so reusing that state here would make reduced motion
       * say the track was paused.
       */
      cancelAnimation(h);
      h.value = maxH;
    } else if (playing) {
      h.value = withDelay(delay, withRepeat(withTiming(maxH, { duration }), -1, true));
    } else {
      cancelAnimation(h);
      h.value = withTiming(minH, { duration: 160 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, reducedMotion]);

  const style = useAnimatedStyle(() => ({ height: h.value }));
  return (
    <Animated.View style={[{ width, borderRadius: width / 2, backgroundColor: color }, style]} />
  );
}

type Props = { color?: string; size?: number; playing: boolean };

/** Four bars that bounce while a track plays and settle flat when paused — the
 * universal "this is the one playing" affordance. Used in the active song row.
 * Composes anywhere: it's just a fixed-height flex-end row of animated bars. */
export function Equalizer({ color = '#ffffff', size = 16, playing }: Props) {
  const barW = Math.max(2, Math.round(size / 7));
  const gap = Math.max(1.5, barW / 2);
  const min = Math.round(size * 0.25);
  const max = size;

  return (
    <View style={{ height: size, flexDirection: 'row', alignItems: 'flex-end', gap }}>
      <Bar
        color={color}
        width={barW}
        minH={min}
        maxH={max}
        duration={420}
        delay={0}
        playing={playing}
      />
      <Bar
        color={color}
        width={barW}
        minH={min}
        maxH={max * 0.7}
        duration={520}
        delay={120}
        playing={playing}
      />
      <Bar
        color={color}
        width={barW}
        minH={min}
        maxH={max}
        duration={360}
        delay={60}
        playing={playing}
      />
      <Bar
        color={color}
        width={barW}
        minH={min}
        maxH={max * 0.8}
        duration={480}
        delay={180}
        playing={playing}
      />
    </View>
  );
}
