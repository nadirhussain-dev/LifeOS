import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { Check } from '@/components/ui/icons';
import { Text } from '@/components/ui/text';
import { CHAINS, FRAMES, THEMES } from '@/features/rewards/config/catalog';
import type { CosmeticKind } from '@/features/rewards/types/rewards.types';
import { useTheme } from '@/hooks/use-theme';

/**
 * One wearable cosmetic, with a preview of what it actually does.
 *
 * The preview is the whole component. A list of names — "Ember Glow",
 * "Keystone Steel" — asks somebody to pick between two words, and the thing
 * they are picking between is a colour. So each row draws itself in its own
 * colours, at roughly the size and shape it appears at on the surface it
 * skins: a chain shows its three dot states, a theme shows its wash, a frame
 * shows its ring.
 *
 * Tapping equips, and tapping the equipped one takes it off. No separate
 * "remove" affordance: the set is small, everything in it is mutually
 * exclusive within its kind, and a second control for the rarer action is a
 * control most people read past.
 */

type Props = {
  kind: CosmeticKind;
  name: string;
  equipped: boolean;
  onPress: () => void;
};

/** The preview, per kind. Nothing here reads the theme — that is the point. */
function Preview({ kind, name }: { kind: CosmeticKind; name: string }) {
  if (kind === 'chain') {
    const art = CHAINS[name];
    if (!art) return null;
    return (
      <View style={{ flexDirection: 'row', gap: 4, alignItems: 'center' }}>
        {[art.kept, art.kept, art.kept, art.shielded, art.kept, art.missed].map((color, i) => (
          <View key={i} style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: color }} />
        ))}
      </View>
    );
  }

  if (kind === 'theme') {
    const art = THEMES[name];
    if (!art) return null;
    // Three bands rather than a real gradient: this repo has no gradient
    // dependency for arbitrary views, and a three-stop approximation reads
    // correctly at 56px wide while costing nothing.
    return (
      <View
        style={{ flexDirection: 'row', width: 56, height: 18, borderRadius: 9, overflow: 'hidden' }}
      >
        <View style={{ flex: 1, backgroundColor: art.from }} />
        <View style={{ flex: 1, backgroundColor: mix(art.from, art.to) }} />
        <View style={{ flex: 1, backgroundColor: art.to }} />
      </View>
    );
  }

  const art = FRAMES[name];
  if (!art) return null;
  return (
    <View
      style={{
        width: 26,
        height: 26,
        borderRadius: 13,
        borderWidth: 3,
        borderTopColor: art.from,
        borderLeftColor: art.from,
        borderRightColor: art.to,
        borderBottomColor: art.to,
      }}
    />
  );
}

/** Midpoint of two hexes, so a two-stop palette can fake a third band. */
function mix(a: string, b: string): string {
  const half = (from: number) => {
    const x = parseInt(a.slice(from, from + 2), 16);
    const y = parseInt(b.slice(from, from + 2), 16);
    return Math.round((x + y) / 2)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${half(1)}${half(3)}${half(5)}`;
}

export function CosmeticRow({ kind, name, equipped, onPress }: Props) {
  const { t } = useTranslation();
  const { c } = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: equipped }}
      onPress={onPress}
      className="flex-row items-center gap-3 rounded-2xl p-3"
      style={{
        borderWidth: 1,
        borderColor: equipped ? c.accent : c.border,
        backgroundColor: equipped ? c.surface : 'transparent',
      }}
    >
      <Preview kind={kind} name={name} />

      <Text className="flex-1 font-sora-medium text-foreground">
        {t(`rewards.cosmetic.${name}`)}
      </Text>

      {equipped ? <Check size={18} color={c.accent} /> : null}
    </Pressable>
  );
}
