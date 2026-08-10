import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';

import { alpha } from '@/lib/color';

type Props = {
  /** Raw values, oldest first. Scaled to fit; absolute magnitude doesn't matter. */
  data: number[];
  tint: string;
  width: number;
  height: number;
  /** Fill the area under the line with a fading wash. */
  fill?: boolean;
};

/**
 * A small trend line, drawn to bleed off both edges of whatever contains it.
 *
 * Built on react-native-svg, which the app already uses for its rings and
 * charts — no new dependency, and it renders inside the same native surface
 * the ProgressRing does.
 *
 * The line deliberately runs edge to edge with no axes, labels or gridlines.
 * It is not a chart; it is the card's texture. Its job is to make a tile read
 * as "this module, and it is going up" at a glance, so it has to survive being
 * looked at for a tenth of a second.
 */
export function Sparkline({ data, tint, width, height, fill = true }: Props) {
  if (data.length < 2 || width <= 0 || height <= 0) return null;

  const max = Math.max(...data);
  const min = Math.min(...data);
  // A flat series would divide by zero; draw it as a centred line instead.
  const span = max - min || 1;

  const stepX = width / (data.length - 1);
  // Inset vertically so the stroke's own width isn't clipped at the extremes.
  const pad = 2;
  const usable = height - pad * 2;
  const pointAt = (value: number, index: number) => {
    const x = index * stepX;
    const y = pad + (1 - (value - min) / span) * usable;
    return [x, y] as const;
  };

  const points = data.map(pointAt);
  const line = points
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`)
    .join(' ');
  const area = `${line} L${width.toFixed(2)},${height} L0,${height} Z`;

  const id = `spark${Math.round(width)}x${Math.round(height)}`;

  return (
    <Svg width={width} height={height} pointerEvents="none">
      {fill && (
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={tint} stopOpacity={0.28} />
            <Stop offset="1" stopColor={tint} stopOpacity={0} />
          </LinearGradient>
        </Defs>
      )}
      {fill && <Path d={area} fill={`url(#${id})`} />}
      <Path
        d={line}
        stroke={tint}
        strokeWidth={2}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* The most recent point, emphasised — the eye lands on "now". */}
      <Path
        d={`M${points[points.length - 1][0].toFixed(2)},${points[points.length - 1][1].toFixed(2)} l0.01,0`}
        stroke={alpha(tint, 1)}
        strokeWidth={6}
        strokeLinecap="round"
      />
    </Svg>
  );
}
