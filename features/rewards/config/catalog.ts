import type {
  BadgeArt,
  ChainArt,
  FrameArt,
  ThemeArt,
} from '@/features/rewards/types/rewards.types';

/**
 * What every earnable cosmetic looks like.
 *
 * ## Why the art is here and not on the server
 *
 * The server decides **who owns what**; this file decides **what it looks
 * like**. That split is deliberate and it is the reason a season's payouts can
 * be edited in the operator console without shipping a build: an operator moves
 * `theme:spark-dawn` from rung 7 to rung 30 and nothing here changes. What an
 * operator cannot do from the console is invent `theme:mauve` — a slug with no
 * entry below renders as nothing at all.
 *
 * `catalog.test.ts` is what stops that being a silent failure: it reads the
 * seed out of migration 0071 and fails if any slug it grants is missing here.
 * The same relationship `entitlements.ts` has to migration 0059, for the same
 * reason — two copies of one fact, and only a test between them.
 *
 * ## These are content colours, not tokens
 *
 * A module tint retunes between light and dark because it has to stay legible
 * against a changing card. A badge does not: it is a thing somebody earned, and
 * it should be the same colour on both themes and in a screenshot pasted into a
 * chat with no theme at all — the same argument `share-card.tsx` makes for
 * carrying its own ground. So these are fixed hexes, chosen to clear 3:1
 * against both cards, and deliberately none of them is a registered module tint
 * (`npm run check:tokens` fails the build if one ever is).
 *
 * ## The ladder they hang on
 *
 * Nine rungs, and each cosmetic kind appears three times up the climb rather
 * than all at once — a badge every rung, then dawn/ember/dusk early,
 * blaze/laurel/crown at the frames, and the gradients and chains interleaved.
 * The point is that no stretch of the ladder is cosmetically silent: the gap
 * between 120 and 180 is two months, and a rung that pays only a badge somebody
 * already has a shelf of is a rung that reads as nothing.
 */

/** Badges — one per rung, and the only kind that is never spent or replaced. */
export const BADGES: Record<string, BadgeArt> = {
  spark: { icon: 'sparkles', ink: '#fef3c7', ground: '#b45309' },
  ember: { icon: 'flame', ink: '#fee2e2', ground: '#9a3412' },
  flame: { icon: 'flame', ink: '#ffe4e6', ground: '#be123c' },
  blaze: { icon: 'award', ink: '#fae8ff', ground: '#a21caf' },
  keystone: { icon: 'gem', ink: '#e0e7ff', ground: '#3730a3' },
  'half-year': { icon: 'award', ink: '#ccfbf1', ground: '#115e59' },
  forge: { icon: 'shield', ink: '#fef9c3', ground: '#854d0e' },
  summit: { icon: 'mountain', ink: '#dbeafe', ground: '#1e40af' },
  'year-one': { icon: 'crown', ink: '#fdf4ff', ground: '#6b21a8' },
};

/** Gradient washes, for the challenge screen's header and the share card. */
export const THEMES: Record<string, ThemeArt> = {
  'spark-dawn': { from: '#f97316', to: '#fbbf24' },
  'flame-dusk': { from: '#be123c', to: '#7c2d92' },
  'forge-gold': { from: '#854d0e', to: '#eab308' },
};

/**
 * Chain colours — the three dot states the braid and the share card draw.
 *
 * The most valuable cosmetic in the set, and the cheapest to build, because it
 * repaints the one surface somebody looks at every single day and the one that
 * leaves the app in a screenshot. REWARDS_STRATEGY's point about cosmetics only
 * carrying value where other people see them applies more here than anywhere:
 * nobody sees your app icon, everybody sees your streak card.
 */
export const CHAINS: Record<string, ChainArt> = {
  'ember-glow': { kept: '#fb923c', shielded: '#7c2d12', missed: '#f43f5e' },
  'keystone-steel': { kept: '#94a3b8', shielded: '#334155', missed: '#fb7185' },
  'summit-aurora': { kept: '#38bdf8', shielded: '#1e3a5f', missed: '#f472b6' },
};

/** Rings drawn around an avatar. */
export const FRAMES: Record<string, FrameArt> = {
  'blaze-ring': { from: '#a21caf', to: '#f0abfc' },
  'half-year-laurel': { from: '#0d9488', to: '#5eead4' },
  'year-one-crown': { from: '#6b21a8', to: '#fbbf24' },
};

/**
 * The default chain, for everybody who has not earned or equipped one.
 *
 * Lifted from the values `braid.tsx` and `share-card.tsx` were already drawing,
 * so switching them onto the catalog changes nothing for a user with no
 * cosmetics — which is the only safe way to introduce a skinning layer under a
 * surface people already recognise.
 */
export const DEFAULT_CHAIN: ChainArt = {
  kept: '#9c92ff',
  shielded: '#2f2d48',
  missed: '#f4809c',
};

/** Splits `badge:spark` into its two halves. Returns null for a malformed slug
 *  rather than throwing: this parses data that arrived over a network. */
export function parseSlug(slug: string): { kind: string; name: string } | null {
  const at = slug.indexOf(':');
  if (at <= 0 || at === slug.length - 1) return null;
  return { kind: slug.slice(0, at), name: slug.slice(at + 1) };
}

/** Every cosmetic slug this build can draw, in `kind:name` form. What the
 *  catalog test compares the migration's seed against. */
export function knownCosmeticSlugs(): string[] {
  return [
    ...Object.keys(BADGES).map((n) => `badge:${n}`),
    ...Object.keys(THEMES).map((n) => `theme:${n}`),
    ...Object.keys(CHAINS).map((n) => `chain:${n}`),
    ...Object.keys(FRAMES).map((n) => `frame:${n}`),
  ];
}
