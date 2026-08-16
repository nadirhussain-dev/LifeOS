import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated as RNAnimated, ScrollView, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { cardClass } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import type { ChainDay } from '@/features/challenge/types/challenge.types';
import { useTheme } from '@/hooks/use-theme';

/** `react-native-svg`'s Path accepts animated props through the RN driver. */
const AnimatedPath = RNAnimated.createAnimatedComponent(Path);

/**
 * The braid — one strand per committed module, woven a day at a time.
 *
 * This replaces the dot chain, and the reason is competitive rather than
 * aesthetic: the incumbent's signature image is a grid of cells that fill in,
 * and a grid of dots that fill in reads as a version of it however different the
 * underlying idea is. The braid is not available to them, because the mechanic
 * it draws — several commitments that must *all* hold on the same day — is the
 * one thing they do not have.
 *
 * What it encodes, exactly:
 *
 *   - A strand is a module. Its colour is that module's tint, so the strands are
 *     the same colours as the rest of the app.
 *   - A clean weave is a day where everything held.
 *   - A break in one strand is *that module* missed. It is drawn as a gap, with
 *     a hairline ghost still running underneath — absence has to look like
 *     absence, not like nothing was ever drawn there.
 *   - A shielded day is a splice: dashed and neutral. Spliced, not broken. The
 *     shield did its job and the run continued, and the picture should say so.
 *
 * Drawn with `react-native-svg` and nothing else. The repo has deliberately
 * never taken a chart dependency (see the note on charts in the design docs),
 * and three sine paths do not justify breaking that.
 */

/** Horizontal pixels per day. Wide enough to see a gap, tight enough that a
 *  month fits on a phone without scrolling. */
const DAY_WIDTH = 11;
/** Height of the drawing, and how far a strand swings from the centre line. */
const HEIGHT = 64;
const AMPLITUDE = 15;
/** Days per full sine period — how tight the weave looks. */
const PERIOD = 14;
/** Points sampled per day. Six is smooth at this amplitude and cheap. */
const STEPS = 6;

type Segment = {
  d: string;
  kind: 'held' | 'shielded' | 'missed';
  strand: number;
  /** The run containing the most recent day — the only one allowed to move. */
  isNewest: boolean;
};

/**
 * Turns the ledger into one path string per unbroken run.
 *
 * Split into runs rather than drawn as a single path with moves, because a
 * dashed splice and a solid weave need different strokes — and a `Path` per run
 * is still only a handful of nodes for a month of days.
 */
function buildSegments(days: ChainDay[], modules: string[]): Segment[] {
  const segments: Segment[] = [];

  modules.forEach((moduleId, strand) => {
    const phase = (strand * Math.PI * 2) / Math.max(modules.length, 1);
    const y = (dayIndex: number) =>
      HEIGHT / 2 + AMPLITUDE * Math.sin((dayIndex / PERIOD) * Math.PI * 2 + phase);

    let run: string[] = [];
    let runKind: Segment['kind'] = 'held';

    const flush = () => {
      if (run.length > 1) {
        segments.push({ d: run.join(' '), kind: runKind, strand, isNewest: false });
      }
      run = [];
    };

    days.forEach((day, index) => {
      // A shielded day covered the whole day, so no single module failed on it.
      // A missed day fails only the modules that were actually absent.
      const kind: Segment['kind'] =
        day.outcome === 'shielded'
          ? 'shielded'
          : day.modulesHit.includes(moduleId)
            ? 'held'
            : 'missed';

      if (kind !== runKind) {
        flush();
        runKind = kind;
      }

      for (let step = 0; step <= STEPS; step++) {
        const at = index + step / STEPS;
        const command = run.length === 0 ? 'M' : 'L';
        run.push(`${command}${(at * DAY_WIDTH).toFixed(1)} ${y(at).toFixed(1)}`);
      }
    });

    flush();

    // The run holding the most recent day is the last one pushed for this
    // strand — and the only one the closing moment is allowed to animate.
    // Marked here rather than inside `flush`, which cannot know it is the last
    // time it will be called.
    for (let i = segments.length - 1; i >= 0; i--) {
      if (segments[i].strand === strand) {
        segments[i] = { ...segments[i], isNewest: true };
        break;
      }
    }
  });

  return segments;
}

/** The faint continuous line under everything, so a gap reads as a gap. */
function ghostPath(days: number, strand: number, strands: number): string {
  const phase = (strand * Math.PI * 2) / Math.max(strands, 1);
  const points: string[] = [];
  for (let at = 0; at <= days; at += 0.5) {
    const y = HEIGHT / 2 + AMPLITUDE * Math.sin((at / PERIOD) * Math.PI * 2 + phase);
    points.push(`${points.length === 0 ? 'M' : 'L'}${(at * DAY_WIDTH).toFixed(1)} ${y.toFixed(1)}`);
  }
  return points.join(' ');
}

type Props = {
  days: ChainDay[];
  /** The committed modules, in the order they were committed to. */
  modules: string[];
  /** True for the couple of seconds after the day closed — see `useDayClosed`. */
  justClosed?: boolean;
};

export function Braid({ days, modules, justClosed = false }: Props) {
  const { t } = useTranslation();
  const { c, tint } = useTheme();
  const scroller = useRef<ScrollView>(null);

  const segments = useMemo(() => buildSegments(days, modules), [days, modules]);
  const width = Math.max(days.length * DAY_WIDTH, 1);

  /**
   * The newest end of the weave breathes once when the day closes.
   *
   * Deliberately the *only* thing that animates here. A braid where every
   * strand moves is a screensaver; a braid where the end you just added
   * brightens for a beat is the weave acknowledging the day and settling. The
   * RN `Animated` driver is used rather than Reanimated because
   * react-native-svg's props are animatable through it natively, and one opacity
   * value does not justify a wrapper component.
   */
  const glow = useRef(new RNAnimated.Value(0)).current;
  useEffect(() => {
    if (!justClosed) return;
    RNAnimated.sequence([
      RNAnimated.timing(glow, { toValue: 1, duration: 260, useNativeDriver: true }),
      RNAnimated.timing(glow, { toValue: 0, duration: 900, useNativeDriver: true }),
    ]).start();
  }, [justClosed, glow]);

  // The end of the braid is what somebody is looking for, and after a day
  // closes it is the only thing they are looking for.
  useEffect(() => {
    if (days.length > 0) scroller.current?.scrollToEnd({ animated: justClosed });
  }, [days.length, justClosed]);

  if (days.length === 0 || modules.length === 0) return null;

  // Module tints where one exists, falling back to the accent — a module the
  // tint table doesn't know about should still be visible rather than absent.
  const strandColor = (index: number): string => {
    const known: Record<string, string> = {
      habits: tint('habit'),
      tasks: tint('calendar'),
      journal: tint('journal'),
      water: tint('water'),
      sleep: tint('sleep'),
      study: tint('study'),
      goals: tint('goals'),
      notes: tint('notes'),
    };
    return known[modules[index]] ?? c.accent;
  };

  return (
    <View className={cardClass({ padding: 'md' }, 'gap-3')}>
      <Text variant="micro">{t('challenge.braidTitle')}</Text>

      {/* Newest on the right, and scrolled there — the end of the braid is the
          part somebody is actually looking for. */}
      <ScrollView
        ref={scroller}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingRight: 4 }}
      >
        <Svg width={width} height={HEIGHT}>
          {modules.map((moduleId, strand) => (
            <Path
              key={`ghost-${moduleId}`}
              d={ghostPath(days.length, strand, modules.length)}
              stroke={c.border}
              strokeWidth={1}
              fill="none"
            />
          ))}

          {segments.map((segment, index) => (
            <AnimatedPath
              key={`${segment.strand}-${index}`}
              d={segment.d}
              fill="none"
              strokeLinecap="round"
              stroke={
                segment.kind === 'missed'
                  ? c.warning
                  : segment.kind === 'shielded'
                    ? c.mutedForeground
                    : strandColor(segment.strand)
              }
              strokeWidth={segment.kind === 'held' ? 2.5 : 2}
              strokeDasharray={
                segment.kind === 'shielded' ? '2 3' : segment.kind === 'missed' ? '1 4' : undefined
              }
              opacity={
                segment.isNewest
                  ? glow.interpolate({ inputRange: [0, 1], outputRange: [1, 0.35] })
                  : segment.kind === 'held'
                    ? 1
                    : 0.55
              }
            />
          ))}
        </Svg>
      </ScrollView>

      <View className="flex-row flex-wrap gap-x-4 gap-y-1">
        {modules.map((moduleId, strand) => (
          <View key={moduleId} className="flex-row items-center gap-1.5">
            <View
              className="h-0.5 w-4 rounded-full"
              style={{ backgroundColor: strandColor(strand) }}
            />
            <Text variant="caption">{t(`syncModule.${moduleId}`)}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
