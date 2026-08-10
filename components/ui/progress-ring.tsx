import { useEffect, useId, type ReactNode } from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedProps, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { colors } from '@/constants/theme';
import { tintGradient } from '@/lib/color';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/** Halo stroke widths as multiples of the arc's own. Two passes rather than a
 *  blur: react-native-svg's filter support is not somewhere to place a bet,
 *  and at ring sizes a pair of faint wide strokes is indistinguishable. */
const HALO_OUTER = 2.2;
const HALO_INNER = 1.5;

type Props = {
  /** 0–1. */
  progress: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
  trackColor?: string;
  /** Content centered inside the ring (a number, label, icon…). */
  children?: ReactNode;
  /** Milliseconds for the sweep animation when progress changes. */
  duration?: number;
  /** Paint the arc with a gradient derived from `color` (premium look). */
  gradient?: boolean;
  /**
   * Soft halo of the arc's own colour behind the stroke.
   *
   * On by default. The design system's goal-gradient note says a near-complete
   * ring should "brighten with a subtle glow" — that was written down and never
   * built, so every ring in the app ended in a hard edge. Pass `false` for
   * rings drawn on a saturated fill, where a coloured halo has nothing to
   * bloom against.
   */
  glow?: boolean;
};

/**
 * Animated circular progress ring built on react-native-svg + Reanimated.
 * The arc sweeps from 12 o'clock and animates whenever `progress` changes.
 * With `gradient`, the stroke is painted with a two-stop gradient derived from
 * `color` — the signature "glowing ring" of the premium design language.
 */
export function ProgressRing({
  progress,
  size = 160,
  strokeWidth = 12,
  color,
  trackColor,
  children,
  duration = 700,
  gradient,
  glow = true,
}: Props) {
  const scheme = useColorScheme() ?? 'light';
  // useId() emits colons (":r0:") which are invalid inside an SVG url(#id)
  // reference and break the gradient on Android's native SVG — strip them.
  const gradientId = `ring${useId().replace(/:/g, '')}`;
  const clamped = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));

  // The halo is drawn as a wider stroke on the same circle, so the radius has
  // to leave room for HALF of the widest one or it clips against the SVG edge —
  // which looks like the ring has been sliced flat, considerably worse than no
  // glow at all. Costs a few points of radius when the glow is on.
  const outerStroke = glow ? strokeWidth * HALO_OUTER : strokeWidth;
  const radius = (size - outerStroke) / 2;
  const circumference = 2 * Math.PI * radius;

  // Goal-gradient: the design system says a near-complete ring should
  // "brighten with a subtle glow". That was written down and never built. The
  // halo is barely there early on and strongest as the ring closes, so the
  // last stretch is the one that looks alive.
  const bloom = clamped ** 2;

  const animated = useSharedValue(0);

  useEffect(() => {
    animated.value = withTiming(clamped, { duration });
  }, [animated, clamped, duration]);

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: circumference * (1 - animated.value),
  }));

  const arcColor = color ?? colors[scheme].accent;
  const track = trackColor ?? colors[scheme].muted;
  const [gradStart, gradEnd] = tintGradient(arcColor);
  const stroke = gradient ? `url(#${gradientId})` : arcColor;

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        {gradient && (
          <Defs>
            <LinearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
              <Stop offset="0%" stopColor={gradStart} />
              <Stop offset="100%" stopColor={gradEnd} />
            </LinearGradient>
          </Defs>
        )}
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={track}
          strokeWidth={strokeWidth}
          fill="none"
        />
        {/* The bloom: the same arc drawn underneath, wider and faint, so the
            stroke sits in a soft halo of its own colour instead of ending in a
            hard edge. Two passes rather than a blur because react-native-svg's
            filter support is not somewhere to place a bet, and this reads the
            same at ring sizes. Skipped entirely when `glow` is off, and when
            progress is zero there is nothing to bloom. */}
        {glow &&
          clamped > 0 &&
          [
            { width: strokeWidth * HALO_OUTER, opacity: 0.13 * bloom },
            { width: strokeWidth * HALO_INNER, opacity: 0.2 * bloom },
          ].map((halo) => (
            <AnimatedCircle
              key={halo.width}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              stroke={arcColor}
              strokeOpacity={halo.opacity}
              strokeWidth={halo.width}
              fill="none"
              strokeLinecap="round"
              strokeDasharray={circumference}
              animatedProps={animatedProps}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
            />
          ))}
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={stroke}
          strokeWidth={strokeWidth}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          animatedProps={animatedProps}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      {children}
    </View>
  );
}
