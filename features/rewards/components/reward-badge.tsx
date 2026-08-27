import { View } from 'react-native';

import { Award, Crown, Flame, Gem, Mountain, Shield, Sparkles } from '@/components/ui/icons';
import { Text } from '@/components/ui/text';
import { BADGES } from '@/features/rewards/config/catalog';

/**
 * One earned badge, drawn.
 *
 * Carries its own two colours rather than reading the theme, for the reason
 * `catalog.ts` gives: a badge is a thing somebody earned and it should look
 * identical on both themes and in a screenshot with no theme at all. The only
 * thing that changes with the theme is the *locked* treatment, because that is
 * chrome rather than an award.
 */

const ICONS = {
  flame: Flame,
  sparkles: Sparkles,
  award: Award,
  crown: Crown,
  shield: Shield,
  mountain: Mountain,
  gem: Gem,
} as const;

type Props = {
  /** The bare catalog name — `spark`, not `badge:spark`. */
  name: string;
  size?: number;
  /**
   * Draw it as not-yet-earned: the silhouette, in the surface colour.
   *
   * Shown rather than hidden, deliberately. A ladder whose unclaimed rungs are
   * blank tells somebody nothing about what climbing is for, and the whole
   * argument for cosmetics is that they are wanted before they are owned.
   */
  locked?: boolean;
  lockedGround?: string;
  lockedInk?: string;
};

export function RewardBadge({ name, size = 44, locked = false, lockedGround, lockedInk }: Props) {
  const art = BADGES[name];
  if (!art) return null;

  const Icon = ICONS[art.icon];

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: locked ? (lockedGround ?? 'transparent') : art.ground,
        borderWidth: locked ? 1 : 0,
        borderColor: lockedInk,
      }}
    >
      <Icon size={size * 0.5} color={locked ? (lockedInk ?? art.ground) : art.ink} />
    </View>
  );
}

/** A badge with its rung name under it — the trophy case's unit. */
export function RewardBadgeTile({
  name,
  label,
  locked,
  lockedGround,
  lockedInk,
  labelColor,
}: Props & { label: string; labelColor?: string }) {
  return (
    <View style={{ width: 76, alignItems: 'center', gap: 6 }}>
      <RewardBadge name={name} locked={locked} lockedGround={lockedGround} lockedInk={lockedInk} />
      <Text
        variant="caption"
        numberOfLines={1}
        style={labelColor ? { color: labelColor } : undefined}
      >
        {label}
      </Text>
    </View>
  );
}
