/**
 * What somebody has earned, as the client sees it.
 *
 * Field names mirror the JSON `my_challenge_rewards()` hands back
 * (supabase/migrations/0071_challenge_rewards.sql) rather than the snake_case
 * columns behind it, for the same reason `challenge.types.ts` does.
 */

/**
 * The kinds of thing a rung can pay out.
 *
 * Split into two groups on purpose, because they behave differently everywhere
 * downstream: a **cosmetic** is a thing you own and can put on, a **consumable**
 * is a thing that happened to your account once. The trophy case renders the
 * first group; the second group appears in the timeline and nowhere else,
 * because there is nothing to display — the premium window shows up as the
 * account being premium, which is the whole point of it.
 */
export const COSMETIC_KINDS = ['badge', 'theme', 'chain', 'frame', 'icon'] as const;
export type CosmeticKind = (typeof COSMETIC_KINDS)[number];

export type RewardKind = CosmeticKind | 'shield' | 'premium';

export function isCosmetic(kind: string): kind is CosmeticKind {
  return (COSMETIC_KINDS as readonly string[]).includes(kind);
}

/** One row off the shelf. */
export type UserReward = {
  /** `kind:slug` for a cosmetic, `kind:season:rung` for a consumable. */
  slug: string;
  kind: RewardKind;
  seasonId: string | null;
  /** The rung that paid it, or null for a reward from some other source. */
  tierDay: number | null;
  /** The effect exactly as it was written on the rung when it paid out. */
  detail: Record<string, unknown>;
  grantedAt: string;
};

/**
 * A cosmetic's identity in the catalog, keyed by the bare slug rather than the
 * prefixed one — `spark`, not `badge:spark`. The prefix is the ledger's
 * business; a theme and a badge can share a name without colliding because
 * they are looked up in different maps.
 */
export type BadgeArt = {
  /** Lucide icon name, resolved through the catalog's own icon map. */
  icon: 'flame' | 'sparkles' | 'award' | 'crown' | 'shield' | 'mountain' | 'gem';
  /** The badge's own two colours. Content colours, not module tints — a badge
   *  looks the same for everybody, which is what makes it worth having. */
  ink: string;
  ground: string;
};

/** Two stops. Enough for a card wash and a ring sweep; more is a design that
 *  fights the surface it sits on. */
export type ThemeArt = { from: string; to: string };

/** The three dot states the braid and the share card draw. */
export type ChainArt = { kept: string; shielded: string; missed: string };

/** A ring drawn around an avatar. Two colours so it can be a sweep. */
export type FrameArt = { from: string; to: string };
