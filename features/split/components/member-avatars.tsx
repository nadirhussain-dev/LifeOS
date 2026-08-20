import { View } from 'react-native';

import { Text } from '@/components/ui/text';
import { chartSeries, colors as dsColors } from '@/constants/design-tokens';
import { useColorScheme } from '@/hooks/use-color-scheme';

/**
 * Overlapping initial chips for a group's members.
 *
 * A group's identity is the people in it, and a row that said "4 people" made
 * every group look the same. Colour is derived from the name, so the same
 * person keeps the same chip everywhere without needing an avatar stored
 * anywhere — and the palette is the chart series, which is already tuned for
 * both themes and for being distinguishable side by side.
 */

/*
 * `chartSeries`, which is what the note above always claimed this was — but it
 * had been re-typed as a near-copy that drifted: six entries against the
 * series' seven, a different first colour and a different last, and ten of the
 * twelve values were characters-identical to a registered module tint. Reading
 * the real thing makes the comment true and deletes the copy.
 */
const PALETTE = chartSeries;

/** Stable per-name colour: same string always lands on the same swatch. */
function colorFor(name: string, scheme: 'light' | 'dark'): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  const row = PALETTE[scheme];
  return row[hash % row.length];
}

/** First letter of the name, or of the email's local part. */
function initial(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  return trimmed[0].toUpperCase();
}

type Props = {
  names: string[];
  /** Total members, so an overflow chip can say how many are not shown. */
  total?: number;
  size?: number;
};

export function MemberAvatars({ names, total, size = 26 }: Props) {
  const scheme = useColorScheme() ?? 'light';
  const shown = names.slice(0, 3);
  const overflow = Math.max(0, (total ?? names.length) - shown.length);
  if (shown.length === 0) return null;

  const chip = (
    key: string,
    label: string,
    background: string,
    foreground: string,
    index: number,
  ) => (
    <View
      key={key}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: background,
        borderWidth: 2,
        borderColor: dsColors[scheme].card,
        marginLeft: index === 0 ? 0 : -size * 0.3,
      }}
    >
      <Text
        className="font-sora-bold"
        style={{ fontSize: size * 0.42, color: foreground }}
        // These are decorative: the row already names the group and its size.
        maxFontSizeMultiplier={1}
      >
        {label}
      </Text>
    </View>
  );

  return (
    // One label for the cluster; three separate "T", "A", "+2" announcements
    // would be noise.
    <View
      className="flex-row items-center"
      accessible
      accessibilityRole="image"
      accessibilityLabel={names.join(', ')}
    >
      {shown.map((name, index) =>
        chip(`${name}-${index}`, initial(name), colorFor(name, scheme), '#ffffff', index),
      )}
      {overflow > 0
        ? chip(
            'overflow',
            `+${overflow}`,
            dsColors[scheme].surface,
            dsColors[scheme].mutedForeground,
            shown.length,
          )
        : null}
    </View>
  );
}
