import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { View, type LayoutChangeEvent, type StyleProp, type TextStyle } from 'react-native';

import { Text } from '@/components/ui/text';

/** Headroom left on the measured width, so sub-pixel rounding between the
 * measuring pass and the real one never lands a line a pixel over its slot. */
const SAFETY = 0.97;

/** Below this even the last-resort rendering stops being a number anybody can
 * read, so it is the one floor that `minSize` cannot lower. */
const ABSOLUTE_MIN = 8;

/**
 * Which rendering to draw, and at what size.
 *
 * `widths` are the *measured* natural widths of each candidate at `size`, in
 * preference order. Text width is linear in font size, so the size at which a
 * candidate exactly fills `available` is `size × available / width` — no
 * per-glyph guessing involved. The first candidate that fits at or above
 * `minSize` wins; if none does, the last (shortest) is shrunk as far as it
 * needs, down to `ABSOLUTE_MIN`.
 */
export function chooseFit(
  widths: readonly number[],
  available: number,
  size: number,
  minSize: number,
): { index: number; fontSize: number } {
  if (available <= 0 || widths.length === 0) return { index: 0, fontSize: size };
  const fitAt = (width: number) =>
    width <= 0 ? size : Math.min(size, Math.floor((size * available * SAFETY) / width));
  for (let index = 0; index < widths.length; index += 1) {
    const fontSize = fitAt(widths[index]);
    if (fontSize >= minSize) return { index, fontSize };
  }
  const last = widths.length - 1;
  return { index: last, fontSize: Math.max(ABSOLUTE_MIN, fitAt(widths[last])) };
}

type Group = { size: number | null; report: (id: string, size: number | null) => void };
const GroupContext = createContext<Group | null>(null);

/**
 * Makes every `FittedText` inside it render at the same size — the smallest
 * any one of them needed.
 *
 * Three figures across a row are read as a set. Fitted independently, a
 * `PKR 0.00` sat at 15px beside a `PKR 50,000.00` squeezed to 11px, and the row
 * looked broken even though every number was whole.
 */
export function FittedTextGroup({ children }: { children: ReactNode }) {
  const [sizes, setSizes] = useState<Record<string, number>>({});
  // Stable across size changes: members depend on it in effects, and a new
  // function per report would have them unregister and re-register forever.
  const report = useCallback((id: string, next: number | null) => {
    setSizes((current) => {
      if (next === null) {
        if (!(id in current)) return current;
        const { [id]: _removed, ...rest } = current;
        return rest;
      }
      return current[id] === next ? current : { ...current, [id]: next };
    });
  }, []);
  const all = Object.values(sizes);
  const size = all.length > 0 ? Math.min(...all) : null;
  const value = useMemo<Group>(() => ({ size, report }), [size, report]);
  return <GroupContext.Provider value={value}>{children}</GroupContext.Provider>;
}

type Props = {
  /** The preferred, complete rendering. */
  text: string;
  /**
   * Shorter renderings of the same value, most faithful first ("PKR 50,000"
   * before "PKR 50k"). Each is tried only when the one before it will not fit
   * at `minSize`.
   */
  fallbacks?: readonly string[];
  /** Font size when the slot has room for `text`. */
  size: number;
  /** Smallest size a rendering may shrink to before the next one takes over. */
  minSize: number;
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
 * ## Measured, not estimated
 *
 * This used to predict width from a character count times a per-glyph advance,
 * then correct itself from `onTextLayout`. The prediction was short for
 * `PKR 50,000.00`, and the correction could never fire: by the time the line
 * was reported it had already been ellipsised to the slot's width, so it looked
 * like a line that fitted. The Budget hero shipped `PKR 50,000....` because of
 * it.
 *
 * Now every candidate is laid out once, invisibly, at `size` and with no width
 * limit, in the same `Text` with the same classes — same font, same weight,
 * same OS font scale. That is its true width, and the fit is arithmetic on it.
 * The visible text stays transparent until those measurements are in, so no
 * frame ever shows a truncated figure.
 *
 * `adjustsFontSizeToFit` stays on the visible line as a last guarantee: if the
 * platform ever disagrees with the measurement, it shrinks instead of drawing
 * an ellipsis.
 */
export function FittedText({
  text,
  fallbacks = [],
  size,
  minSize,
  className,
  style,
  align = 'start',
  lineHeightRatio = 1.2,
  testID,
}: Props) {
  const id = useId();
  const group = useContext(GroupContext);
  const [slot, setSlot] = useState(0);
  const [measured, setMeasured] = useState<Record<string, number>>({});

  const candidates = useMemo(
    () => [text, ...fallbacks].filter((value, index, all) => all.indexOf(value) === index),
    // Callers build `fallbacks` inline; the joined strings are the real identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [text, fallbacks.join('\u0000')],
  );
  const widths = candidates.map((candidate) => measured[candidate]);
  const ready = slot > 0 && widths.every((width) => width !== undefined);

  const fit = ready ? chooseFit(widths as number[], slot, size, minSize) : null;
  const shown = fit ? candidates[fit.index] : text;
  const ownSize = fit?.fontSize ?? size;
  const fontSize = group?.size != null ? Math.min(ownSize, group.size) : ownSize;

  const report = group?.report;
  const reported = fit ? fit.fontSize : null;
  useEffect(() => {
    report?.(id, reported);
  }, [report, id, reported]);
  useEffect(() => () => report?.(id, null), [report, id]);

  const onSlotLayout = (event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.width;
    // Guarded: setting state unconditionally on every layout pass re-renders a
    // screen full of these on every scroll-driven relayout.
    setSlot((current) => (Math.abs(current - next) > 0.5 ? next : current));
  };

  const onMeasure = (candidate: string) => (event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.width;
    setMeasured((current) =>
      current[candidate] !== undefined && Math.abs(current[candidate] - next) <= 0.5
        ? current
        : { ...current, [candidate]: next },
    );
  };

  const textStyle = (px: number): StyleProp<TextStyle> => [
    { fontSize: px, lineHeight: Math.round(px * lineHeightRatio), fontVariant: ['tabular-nums'] },
    style,
  ];

  return (
    <View
      testID={testID}
      onLayout={onSlotLayout}
      style={{ alignSelf: 'stretch', alignItems: ALIGN[align] }}
    >
      {/* The measuring pass. Absolutely positioned and far wider than any
          figure, so each candidate lays out at its natural width; hidden from
          sight and from assistive tech. */}
      <View
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{ position: 'absolute', top: 0, left: 0, width: 10000, opacity: 0 }}
      >
        {candidates.map((candidate, index) => (
          <Text
            key={candidate}
            testID={testID ? `${testID}-measure-${index}` : undefined}
            numberOfLines={1}
            onLayout={onMeasure(candidate)}
            className={className}
            style={[textStyle(size), { alignSelf: 'flex-start' }]}
          >
            {candidate}
          </Text>
        ))}
      </View>

      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.5}
        className={className}
        // The exact value still reaches a screen reader when a shorter form is
        // what is drawn — the abbreviation is a space compromise, not a
        // decision that the reader does not need the figure.
        accessibilityLabel={shown === text ? undefined : text}
        style={[textStyle(fontSize), ready ? null : { opacity: 0 }]}
      >
        {shown}
      </Text>
    </View>
  );
}
