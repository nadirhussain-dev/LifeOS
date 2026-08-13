import { View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import Svg, { Circle, Line, Polyline, Rect } from 'react-native-svg';

import { Text } from '@/components/ui/text';
import { useReducedMotion } from '@/hooks/use-reduced-motion';

export type DualTrendDatum = {
  label: string;
  barValue: number;
  lineValue: number | null;
};

type Props = {
  data: DualTrendDatum[];
  height?: number;
  barColor: string;
  lineColor: string;
  /** Show only every Nth x-axis label to avoid crowding (month views). */
  labelEvery?: number;
};

const VIEW_WIDTH = 320;

/**
 * Two series, one chart: a bar series and a line series plotted on the same
 * x-axis, each scaled to its OWN max — this is a shape comparison ("do these
 * move together"), not a magnitude comparison, so sharing one scale would
 * misrepresent it. Purpose-built for Insights (the app's only screen that
 * needs two series at once); `BarChart` stays single-series for everywhere
 * else.
 *
 * Built directly in SVG (unlike `BarChart`'s Views) because the bars and the
 * line have to share exact x-coordinates — a View-based bar row and an
 * overlaid SVG line can drift out of alignment as the container's width
 * settles, since the two would compute their positions independently.
 */
export function DualTrendChart({ data, height = 160, barColor, lineColor, labelEvery = 1 }: Props) {
  const reducedMotion = useReducedMotion();
  const plotHeight = height - 22; // reserve space for the label row below

  const barMax = Math.max(...data.map((d) => d.barValue), 1);
  const lineValues = data.map((d) => d.lineValue).filter((v): v is number => v != null);
  const lineMax = Math.max(...lineValues, 1);

  const slotWidth = VIEW_WIDTH / data.length;
  const barWidth = Math.min(20, slotWidth * 0.5);

  const linePoints = data
    .map((d, i) =>
      d.lineValue == null
        ? null
        : {
            x: slotWidth * (i + 0.5),
            y: plotHeight - (d.lineValue / lineMax) * plotHeight,
          },
    )
    .filter((p): p is { x: number; y: number } => p !== null);

  return (
    <Animated.View entering={reducedMotion ? undefined : FadeIn.duration(400)} style={{ height }}>
      <Svg
        width="100%"
        height={plotHeight}
        viewBox={`0 0 ${VIEW_WIDTH} ${plotHeight}`}
        preserveAspectRatio="none"
      >
        <Line
          x1={0}
          y1={plotHeight - 0.5}
          x2={VIEW_WIDTH}
          y2={plotHeight - 0.5}
          stroke={lineColor}
          strokeOpacity={0.15}
          strokeWidth={1}
        />
        {data.map((d, i) => {
          const barHeight = (d.barValue / barMax) * plotHeight;
          const x = slotWidth * (i + 0.5) - barWidth / 2;
          return (
            <Rect
              key={`bar-${i}`}
              x={x}
              y={plotHeight - barHeight}
              width={barWidth}
              height={Math.max(2, barHeight)}
              rx={5}
              fill={barColor}
            />
          );
        })}
        {linePoints.length > 1 && (
          <Polyline
            points={linePoints.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}
            fill="none"
            stroke={lineColor}
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
        {linePoints.map((p, i) => (
          <Circle key={`pt-${i}`} cx={p.x} cy={p.y} r={3} fill={lineColor} />
        ))}
      </Svg>

      <View style={{ flexDirection: 'row', gap: 6, marginTop: 6 }}>
        {data.map((datum, index) => (
          <View key={`label-${index}`} style={{ flex: 1, alignItems: 'center' }}>
            {index % labelEvery === 0 ? (
              <Text variant="caption" numberOfLines={1} style={{ fontSize: 10 }}>
                {datum.label}
              </Text>
            ) : null}
          </View>
        ))}
      </View>
    </Animated.View>
  );
}
