import { type ReactNode } from 'react';
import { View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export type DonutSlice = { value: number; color: string };

type Props = {
  data: DonutSlice[];
  size?: number;
  strokeWidth?: number;
  trackColor?: string;
  /** Content centered in the hole (total, label…). */
  children?: ReactNode;
  /** Gap between segments, in degrees, for visual separation. */
  gap?: number;
};

/**
 * Donut/ring chart from stacked SVG arc segments — one stroked circle per slice
 * offset along the circumference. Starts at 12 o'clock (rotated −90°). The
 * app has no chart library, so this is hand-rolled on react-native-svg and
 * shared by the budget expense breakdown (and available to any future split).
 */
export function DonutChart({
  data,
  size = 180,
  strokeWidth = 26,
  trackColor,
  children,
  gap = 2,
}: Props) {
  const scheme = useColorScheme() ?? 'light';
  const radius = (size - strokeWidth) / 2;
  // The hole is a circle, so a line of text across it has less room than its
  // diameter — the chord shortens as the text sits further from the centre.
  // 0.86 is the width of the chord at the top of a two-line block in a 180px
  // ring, and it is the content box because otherwise `children` lays out
  // against the full 180 and a long total draws straight over the slices.
  const holeWidth = (size - strokeWidth * 2) * 0.86;
  const circumference = 2 * Math.PI * radius;
  const total = data.reduce((sum, slice) => sum + slice.value, 0);
  const gapLength = (gap / 360) * circumference;

  let offset = 0;

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={trackColor ?? colors[scheme].muted}
          strokeWidth={strokeWidth}
          fill="none"
        />
        {total > 0 &&
          data.map((slice, index) => {
            const rawLength = (slice.value / total) * circumference;
            const length = Math.max(0, rawLength - gapLength);
            const dash = `${length} ${circumference - length}`;
            const circle = (
              <Circle
                key={index}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                stroke={slice.color}
                strokeWidth={strokeWidth}
                fill="none"
                strokeLinecap="butt"
                strokeDasharray={dash}
                strokeDashoffset={-offset}
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
              />
            );
            offset += rawLength;
            return circle;
          })}
      </Svg>
      {children ? (
        <View style={{ width: holeWidth, alignItems: 'center', justifyContent: 'center' }}>
          {children}
        </View>
      ) : null}
    </View>
  );
}
