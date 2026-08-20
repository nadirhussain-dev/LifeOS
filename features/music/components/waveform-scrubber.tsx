import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { useReducedMotion } from '@/hooks/use-reduced-motion';

const BAR_COUNT = 40;

/** Deterministic 0.35–1 heights forming a stable waveform silhouette per song. */
function seededHeights(seed: string): number[] {
  let h = 2166136261;
  const out: number[] = [];
  for (let i = 0; i < BAR_COUNT; i++) {
    h ^= seed.charCodeAt(i % Math.max(1, seed.length)) + i * 31;
    h = Math.imul(h, 16777619) >>> 0;
    out.push(0.35 + ((h % 1000) / 1000) * 0.65);
  }
  return out;
}

function Bar({
  maxH,
  ratio,
  filled,
  color,
  playing,
  index,
}: {
  maxH: number;
  ratio: number;
  filled: boolean;
  color: string;
  playing: boolean;
  index: number;
}) {
  const base = Math.max(3, maxH * ratio);
  const h = useSharedValue(base);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (playing && reducedMotion) {
      /*
       * Held at the song's own deterministic silhouette — 40 bars each looping
       * indefinitely is the densest motion in the app, and the shape is the
       * part that carries meaning. It is the same resting height the paused
       * state settles to, which is the right read: the waveform is still the
       * waveform, it just is not dancing.
       */
      cancelAnimation(h);
      h.value = base;
    } else if (playing) {
      h.value = withDelay(
        (index % 7) * 40,
        withRepeat(withTiming(base * 0.62, { duration: 360 + (index % 5) * 60 }), -1, true),
      );
    } else {
      cancelAnimation(h);
      h.value = withTiming(base, { duration: 220 });
    }
    return () => cancelAnimation(h);
  }, [playing, base, index, h, reducedMotion]);

  const style = useAnimatedStyle(() => ({ height: h.value }));
  const barW = Math.max(2, maxH / 14);

  return (
    <Animated.View
      style={[
        { width: barW, borderRadius: barW, backgroundColor: color, opacity: filled ? 1 : 0.28 },
        style,
      ]}
    />
  );
}

type Props = {
  seed: string;
  /** 0–1 playback progress. */
  progress: number;
  playing: boolean;
  color: string;
  height?: number;
  /** Called with a 0–1 fraction on release. */
  onSeek: (fraction: number) => void;
};

/**
 * A live, seekable waveform. Seeded bars form the song's silhouette; the played
 * portion is filled in the song color and the rest is ghosted; bars gently pulse
 * while playing. Drag or tap anywhere to scrub — a playhead tracks your finger
 * and the seek commits on release.
 */
export function WaveformScrubber({ seed, progress, playing, color, height = 56, onSeek }: Props) {
  const [width, setWidth] = useState(0);
  const heights = useMemo(() => seededHeights(seed), [seed]);
  const head = useSharedValue(-1);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(0)
        .onBegin((e) => {
          head.value = Math.min(Math.max(e.x, 0), width);
        })
        .onUpdate((e) => {
          head.value = Math.min(Math.max(e.x, 0), width);
        })
        .onEnd((e) => {
          const f = width > 0 ? Math.min(Math.max(e.x / width, 0), 1) : 0;
          runOnJS(onSeek)(f);
        })
        .onFinalize(() => {
          head.value = -1;
        }),
    [width, head, onSeek],
  );

  const headStyle = useAnimatedStyle(() => ({
    opacity: head.value >= 0 ? 1 : 0,
    transform: [{ translateX: head.value }],
  }));

  const filledCount = Math.round(progress * BAR_COUNT);

  return (
    <GestureDetector gesture={pan}>
      <View
        style={{ height, justifyContent: 'center' }}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            height,
          }}
        >
          {width > 0 &&
            heights.map((ratio, i) => (
              <Bar
                key={i}
                maxH={height}
                ratio={ratio}
                filled={i <= filledCount}
                color={color}
                playing={playing}
                index={i}
              />
            ))}
        </View>
        {/* Drag playhead */}
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              top: 0,
              bottom: 0,
              width: 2,
              borderRadius: 1,
              backgroundColor: '#ffffff',
            },
            headStyle,
          ]}
        />
      </View>
    </GestureDetector>
  );
}
