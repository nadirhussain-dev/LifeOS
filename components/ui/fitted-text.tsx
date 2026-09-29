import { useEffect, useState } from 'react';
import {
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type TextStyle,
  type NativeSyntheticEvent,
  type TextLayoutEventData,
} from 'react-native';

import { Text } from '@/components/ui/text';

/**
 * Per-character advance as a fraction of the font size, for the app's Sora
 * faces.
 *
 * Sora's figures are tabular — every digit has the same advance — so the width
 * of a money string (digits, group separators, a currency symbol) is
 * predictable from a character count in a way that prose is not. Three buckets
 * is all these strings need. The wide bucket is set to the heaviest weight's
 * advance rather than the average: overshooting costs a font step, undershooting
 * costs a clipped number, and only one of those is worth risking.
 */
const ADVANCE = { narrow: 0.32, space: 0.3, wide: 0.64 } as const;
const NARROW_CHARS = ".,:'’·";

/** Safety margin on the estimate, so rounding never lands a string one pixel
 * over the edge of its slot. */
const MARGIN = 1.02;

/** Estimated rendered width of `text` at `size`, in px. */
export function textWidth(text: string, size: number): number {
  let em = 0;
  for (const character of text) {
    if (character === ' ' || character === ' ' || character === ' ') em += ADVANCE.space;
    else if (NARROW_CHARS.includes(character)) em += ADVANCE.narrow;
    else em += ADVANCE.wide;
  }
  return em * size * MARGIN;
}

/**
 * The largest whole font size in `[min, max]` at which `text` fits `width`, or
 * `null` when even `min` overflows — which is the caller's signal to show a
 * shorter rendering of the same value rather than shrink past legibility.
 */
export function fitFontSize(text: string, width: number, max: number, min: number): number | null {
  if (width <= 0) return max;
  for (let size = Math.round(max); size >= Math.round(min); size -= 1) {
    if (textWidth(text, size) <= width) return size;
  }
  return null;
}

type Props = {
  /** The preferred, complete rendering. */
  text: string;
  /** Font size when the slot has room for `text`. */
  size: number;
  /** Smallest size `text` may shrink to before `fallback` takes over. */
  minSize: number;
  /**
   * A shorter rendering of the same value ("$1.2m" for "$1,234,567.89"), used
   * only when `text` will not fit even at `minSize`. Without one, `text` is
   * rendered at `minSize` and truncated.
   */
  fallback?: string;
  /** Weight/colour classes only — never a text-size class, which would fight
   * the size this component computes. */
  className?: string;
  style?: StyleProp<TextStyle>;
  align?: 'start' | 'center' | 'end';
  /** Multiplied by the chosen size to get the line height. */
  lineHeightRatio?: number;
  /** Set on the measuring wrapper — the node that receives `onLayout`. */
  testID?: string;
};

const ALIGN = { start: 'flex-start', center: 'center', end: 'flex-end' } as const;

/**
 * A single line of text that shrinks to fit the width it is given, and swaps in
 * a shorter rendering rather than shrinking past legibility.
 *
 * This exists because money has no upper bound. A fixed type size is a bet that
 * the number will be small, and the layouts that take that bet — three figures
 * side by side in a hero, a balance in the hole of a donut — fail by running
 * their numbers into each other, which reads as one long meaningless digit
 * string rather than as an overflow.
 *
 * The width comes from `onLayout` rather than from an assumption, so the same
 * component works in a third of a phone-width card and in a tablet-width one.
 * Until that first layout arrives the text renders at `size`; it is capped to
 * one line throughout, so the worst the first frame can do is ellipsize.
 *
 * The OS font-scale setting is folded in, because `Text` scales what we compute
 * by up to 1.4× afterwards and a fit that ignored that would overflow on
 * exactly the devices that can least afford it.
 */
export function FittedText({
  text,
  size,
  minSize,
  fallback,
  className,
  style,
  align = 'start',
  lineHeightRatio = 1.2,
  testID,
}: Props) {
  const [width, setWidth] = useState(0);
  /**
   * How much the estimate was out by, learned from what the text actually
   * measured. 1 until the first `onTextLayout` says otherwise.
   *
   * ## Why an estimate needed a correction at all
   *
   * `textWidth` multiplies a character count by a per-character advance taken
   * from reading Sora's metrics. That was close enough for `$1,234.56` and
   * wrong for a hero balance in a currency with a three-letter code: the app
   * shipped `PKR 5,550,000....`, ellipsised, at full size — the estimate said
   * it fitted, the text engine disagreed, and `numberOfLines={1}` did the only
   * thing left. A shipped ellipsis in the largest number on the screen is
   * worse than either a smaller number or an abbreviated one, and it was the
   * one outcome the fallback existed to prevent.
   *
   * Guessing harder is not the fix. Advances differ by weight, by platform,
   * by the font actually loaded, and by whatever the OS substitutes when Sora
   * has not loaded yet — so the number to use is not knowable in advance and
   * is trivially knowable afterwards. `onTextLayout` reports the line's real
   * width; the ratio of that to the estimate is carried into the next fit, and
   * one correction settles it for every subsequent render of that instance.
   */
  const [scale, setScale] = useState(1);
  const { fontScale } = useWindowDimensions();

  // `Text` caps dynamic type at 1.4×; fit against the width that is left once
  // the OS has had its multiplier, and once the measured correction is applied.
  const available = width / Math.min(Math.max(fontScale, 1), 1.4) / scale;

  const fitted = fitFontSize(text, available, size, minSize);
  const truncated = fitted === null;
  const shown = truncated && fallback ? fallback : text;
  const fontSize = truncated
    ? fallback
      ? (fitFontSize(fallback, available, size, minSize) ?? minSize)
      : minSize
    : fitted;

  // A new string is a new measurement; keeping the old correction would apply
  // one string's error to another's.
  useEffect(() => setScale(1), [text, fallback]);

  const onLayout = (event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.width;
    // Guarded: setting state unconditionally on every layout pass re-renders a
    // screen full of these on every scroll-driven relayout.
    setWidth((current) => (Math.abs(current - next) > 0.5 ? next : current));
  };

  const onTextLayout = (event: NativeSyntheticEvent<TextLayoutEventData>) => {
    const line = event.nativeEvent.lines[0];
    if (!line || width <= 0 || !fontSize) return;
    const predicted = textWidth(shown, fontSize);
    if (predicted <= 0 || line.width <= 0) return;
    const observed = line.width / predicted;
    // Only ever widen the estimate. A line reported narrower than predicted is
    // usually a line the engine already truncated, and trusting it would shrink
    // the correction on exactly the render that proves it is needed.
    if (observed <= 1.01) return;
    setScale((current) => (observed > current * 1.01 ? observed : current));
  };

  return (
    <View
      testID={testID}
      onLayout={onLayout}
      style={{ alignSelf: 'stretch', alignItems: ALIGN[align] }}
    >
      <Text
        numberOfLines={1}
        onTextLayout={onTextLayout}
        className={className}
        // The exact value still reaches a screen reader when the compact form
        // is what is drawn — the abbreviation is a space compromise, not a
        // decision that the reader does not need the figure.
        accessibilityLabel={shown === text ? undefined : text}
        style={[
          {
            fontSize,
            lineHeight: Math.round(fontSize * lineHeightRatio),
            fontVariant: ['tabular-nums'],
          },
          style,
        ]}
      >
        {shown}
      </Text>
    </View>
  );
}
