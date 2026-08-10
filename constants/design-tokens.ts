/**
 * LifeOS Design Tokens — the single source of truth for the native side.
 *
 * Philosophy: a Spatial Design System. Calm, spacious, premium. Depth comes
 * from layered surfaces + soft elevation, never from neomorphic bevels or
 * skeuomorphic texture. Chrome stays near-grayscale (with a whisper of the
 * emerald accent bias in the neutrals so nothing reads as "unconsidered gray").
 * Color is spent deliberately: one brand accent, one signature tint per life
 * module, and a strictly separate semantic (success/warning/error/info) system.
 *
 * Where you can use a NativeWind className, prefer it (bg-background,
 * text-muted-foreground, rounded-lg, …) — those resolve from global.css /
 * tailwind.config.js which mirror these values. Reach for this module only
 * where classNames can't: StatusBar, navigation theme objects, SVG charts,
 * Reanimated worklets, expo-linear-gradient stops, native shadow objects.
 *
 * See lib/color.ts for tint → gradient/glow derivation helpers used with the
 * per-module `MODULE_TINTS` below.
 */

import { readableOn } from '@/lib/color';

// ---------------------------------------------------------------------------
// PRIMITIVES — the raw hex ramps. Never reference these from screens directly;
// they exist so the semantic tokens below stay coherent and easy to retune.
// ---------------------------------------------------------------------------

/** Neutrals carry a faint emerald bias (hue ~160, very low saturation) so the
 *  grayscale chrome reads as chosen and warm rather than clinical. The full
 *  ramp is documented for reference; screens consume the semantic tokens below,
 *  never these raw steps. */
export const neutral = {
  0: '#ffffff',
  50: '#f7faf8',
  100: '#eef3f0',
  200: '#e2e9e5',
  300: '#cdd6d1',
  400: '#9aa8a1',
  500: '#6d7a74',
  600: '#4d5852',
  700: '#343d39',
  800: '#252d29',
  900: '#161c19',
  950: '#0e1210',
} as const;

/** Emerald — the one brand accent. Growth, life, "go". */
const emerald = {
  light: '#188b61', // --accent (light)
  base: '#10b981',
  dark: '#47d19f', // --accent (dark)
  onLight: '#ffffff',
  onDark: '#0f241c',
  gradient: ['#22c58e', '#0b6b4f'] as const,
} as const;

/**
 * The brand CTA gradient — deeper than the flat `--accent` at both ends, so it
 * reads as genuine depth rather than a two-tone sticker.
 *
 * Exported because the Button and the FAB both paint it, and both used to hold
 * their own copy of the pair while this one sat here unread, its comment
 * claiming it "matches Button accent gradient" with nothing enforcing that.
 * Every surface that paints the brand CTA takes it from here.
 */
export const accentGradient = emerald.gradient;

/** The glow cast by an accent CTA. Its own name because it is the shadow under
 *  the gradient, not the gradient's own stops. */
export const accentGlow = emerald.light;

// ---------------------------------------------------------------------------
// SEMANTIC COLOR — resolved per theme. Mirrors global.css CSS variables.
// ---------------------------------------------------------------------------

export const colors = {
  light: {
    // grounds & surfaces (the spatial stack: sunken → base → card → raised)
    background: '#f8fbf9',
    surface: '#eef3f0', // sunken wells, grouped-list backing, sub-sections
    card: '#ffffff',
    cardForeground: '#161c19',
    raised: '#ffffff', // cards that float (FAB-adjacent, popovers) — pair w/ elevation

    // text
    foreground: '#161c19',
    mutedForeground: '#6d7a74',
    subtleForeground: '#9aa8a1',

    // brand
    primary: '#161c19',
    primaryForeground: '#ffffff',
    accent: emerald.light,
    accentForeground: emerald.onLight,

    // lines
    border: '#e2e9e5',
    divider: '#eef3f0',
    input: '#e2e9e5',
    ring: emerald.light,

    // semantic — deliberately separate from module tints & brand accent
    success: '#16a34a',
    successForeground: '#ffffff',
    warning: '#d97706',
    warningForeground: '#ffffff',
    error: '#dc2626',
    errorForeground: '#ffffff',
    info: '#2563eb',
    infoForeground: '#ffffff',
  },
  dark: {
    background: '#0e1210',
    surface: '#161c19',
    card: '#1a201d',
    cardForeground: '#eef3f0',
    raised: '#202723',

    foreground: '#eef3f0',
    mutedForeground: '#9aa8a1',
    subtleForeground: '#6d7a74',

    primary: '#eef3f0',
    primaryForeground: '#161c19',
    accent: emerald.dark,
    accentForeground: emerald.onDark,

    border: '#2b332e',
    divider: '#202723',
    input: '#2b332e',
    ring: emerald.dark,

    success: '#4ade80',
    successForeground: '#052e16',
    warning: '#fbbf24',
    warningForeground: '#271900',
    error: '#f87171',
    errorForeground: '#2a0a0a',
    info: '#60a5fa',
    infoForeground: '#0a1a33',
  },
} as const;

export type ThemeName = keyof typeof colors;

// ---------------------------------------------------------------------------
// MODULE TINTS — one signature hue per life area. Used for that module's
// progress ring, hero wash, chart series and iconography. NOT for chrome.
// Cool family = structure & rest (calendar/water/sleep/journal); warm family =
// energy & aspiration (fitness/goals); emerald = the brand + growth (habits).
// Pass any of these through lib/color.ts (tintGradient / glowShadow) so a
// module's whole surface derives from the one value.
//
// Every module must be registered here. Gallery and Music used to hardcode
// their hex in feature files instead — as a single value with no dark variant,
// so neither retuned for dark mode, and Music's teal sat 2° from Budget's while
// failing contrast on light (2.39:1). Keep hues at least ~30° apart and clear of
// the semantic colors above, or two modules start reading as the same thing.
// ---------------------------------------------------------------------------

// The light column additionally has to clear 3:1 against a white card, because
// these are drawn as rings, dots and icons on one. Habit (2.54:1), water
// (2.43:1) and fitness (2.80:1) did not, and were darkened one step to 3.77,
// 3.68 and 3.56 — same hue, same family, now actually visible. Their dark
// counterparts sit on a near-black card and were already fine.
export const moduleTints = {
  habit: { light: '#059669', dark: '#34d399' }, // emerald — growth, streaks
  calendar: { light: '#3b82f6', dark: '#60a5fa' }, // blue — structure, time
  water: { light: '#0891b2', dark: '#22d3ee' }, // cyan — hydration, clarity
  sleep: { light: '#6366f1', dark: '#818cf8' }, // indigo — night, rest
  journal: { light: '#8b5cf6', dark: '#a78bfa' }, // violet — reflection
  fitness: { light: '#ea580c', dark: '#fb923c' }, // orange — exertion, energy
  goals: { light: '#f43f5e', dark: '#fb7185' }, // rose — aspiration, achievement
  budget: { light: '#0d9488', dark: '#2dd4bf' }, // teal — balance, ledgers
  // Deep violet — focus. Journal and Study share the violet family by design
  // (reflection and concentration are neighbours), so they are separated by
  // lightness instead of hue: two full steps apart in both themes. They used to
  // be *identical* in dark mode — both #a78bfa — which is exactly the failure
  // the note above warns about, hiding in the one theme nobody compared.
  study: { light: '#6d28d9', dark: '#8b5cf6' },
  gallery: { light: '#a21caf', dark: '#e879f9' }, // plum — visible change over time
  music: { light: '#4d7c0f', dark: '#a3e635' }, // lime — the one gap left on the wheel
  // Yellow — the sticky-note association is too strong to spend on another hue.
  // The dark value is the #eab308 the Hub had hardcoded, which is fine on a
  // near-black card; the light one is the same hue darkened until it clears 3:1
  // on white (the raw yellow ran at 1.92:1, the least legible value in the app).
  // Caveat worth knowing: at 48°/45° this is the tightest pairing in the table —
  // 27° from fitness and only a few degrees from `warning` in dark. Yellow is
  // structurally crowded and the wheel is full; retune here if Notes and a
  // caution state ever end up adjacent.
  notes: { light: '#a48404', dark: '#eab308' },

  // The private space. These lived in features/private/config/private-modules.ts
  // as single hexes with no dark variant — the same failure Gallery and Music
  // had, in the one part of the app nobody screenshots. The light values already
  // clear 3:1 on a white card (3.35–3.99) so they carry over unchanged; only the
  // dark siblings are new.
  //
  // KNOWN COLLISION, deliberately left as-is for now: the Hub renders the
  // private section in the SAME grid as the regular modules once the vault is
  // open, and all four of these sit inside the 30° exclusion of an existing
  // hue — recovery is 4° from habit, intimacy 6° from fitness, vault 8° from
  // sleep, cycle 14° from goals. Re-hueing four private modules is a design
  // call, not a mechanical one; see the note in docs/design-system.md.
  vault: { light: '#7c6cf0', dark: '#a99cf7' }, // periwinkle — the locked space
  cycle: { light: '#e0518a', dark: '#f08cb2' }, // pink — cycle tracking
  recovery: { light: '#2f9e73', dark: '#57c79a' }, // green — streaks, repair
  intimacy: { light: '#d4653f', dark: '#e89370' }, // terracotta — warmth
  // Moss green, hue 112 — the one open gap between music (86) and
  // habit/recovery/success (157/158/142), rather than a fifth colour dropped
  // into an already-crowded wheel. Shared albums live inside the private
  // space (like the four above) but are visible to the server as ordinary
  // membership metadata, unlike them — worth a genuinely distinct hue rather
  // than one more collision in the 15–350 range this section already has.
  albums: { light: '#317e25', dark: '#8fd685' },

  // Settings is chrome, not a life area, and is the one entry that must NOT
  // read as a colored module — it takes the emerald-biased neutral so it sits
  // quiet at the bottom of the Hub. It was a flat #737373, which is the only
  // grey in the app with no green bias and read as a different family.
  settings: { light: neutral[500], dark: neutral[400] },
} as const;

export type ModuleName = keyof typeof moduleTints;

/**
 * A tint that has been designed for both themes.
 *
 * Any registry that carries a per-entry color (the Hub, the private space)
 * should hold one of these rather than a bare hex — a single value means the
 * light column silently gets used on dark grounds too, which is exactly how
 * the Hub grid ended up never retuning.
 */
export type TintPair = { readonly light: string; readonly dark: string };

/** Resolve a `TintPair` for the active theme. */
export function resolveTint(pair: TintPair, theme: ThemeName): string {
  return pair[theme];
}

/**
 * Swatches for user-facing CONTENT — budget categories, goal categories, mood,
 * savings-goal colours, confetti. Deliberately separate from the module tints
 * and the semantic set: these identify a thing the user picked, not a state the
 * app is in, and reusing a module hue here is fine because the two never
 * compete for the same meaning.
 *
 * Named and paired for two reasons.
 *
 * They were duplicated. `CONFETTI_COLORS` was character-for-character the same
 * six values as `categoryColorPalette`, `SAVINGS_COLORS` was five of the same
 * six in a different order, and the budget, goal and mood tables each re-typed
 * their own overlapping subset — six lists, one palette, no link between them.
 *
 * And they had no dark column. Every module tint got a dark variant and every
 * one of these did not, so a budget donut drew the same #eab308 on a white card
 * and on a near-black one. The light values here are unchanged — light mode
 * looks exactly as it did — and the dark ones are new.
 */
export const contentTints = {
  orange: { light: '#f97316', dark: '#fb923c' },
  yellow: { light: '#eab308', dark: '#facc15' },
  green: { light: '#22c55e', dark: '#4ade80' },
  sky: { light: '#0ea5e9', dark: '#38bdf8' },
  violet: { light: '#8b5cf6', dark: '#a78bfa' },
  pink: { light: '#ec4899', dark: '#f472b6' },
  indigo: { light: '#6366f1', dark: '#818cf8' },
  lime: { light: '#84cc16', dark: '#a3e635' },
  teal: { light: '#14b8a6', dark: '#2dd4bf' },
  red: { light: '#ef4444', dark: '#f87171' },
  purple: { light: '#a855f7', dark: '#c084fc' },
  /** "Other" / uncategorised. The emerald-biased neutral, not a flat grey. */
  neutral: moduleTints.settings,
} as const satisfies Record<string, TintPair>;

export type ContentTintName = keyof typeof contentTints;

/**
 * The six-swatch picker offered for user-created content (task categories,
 * note folders). A subset of `contentTints` — the picker stays small on
 * purpose, while the tables above can reach the full set.
 */
export const contentPalette = [
  contentTints.orange,
  contentTints.yellow,
  contentTints.green,
  contentTints.sky,
  contentTints.violet,
  contentTints.pink,
] as const;

/**
 * The budget ledger's three-way colour: money in, money out, money set aside.
 *
 * Derived from the semantic set rather than given its own hexes, because that
 * is what these already meant — income was `#22c55e`, a hand-typed green that
 * is neither `success.light` nor `success.dark`. The triad was written out
 * three times (the transaction form, the transaction row and the reports
 * charts) and `app/budget/index.tsx` managed to use the raw pair for a progress
 * bar and the real tokens for the caption two lines below it, so one state
 * rendered in two different reds.
 *
 * Consequence worth knowing: "income green" and "task completed green" are now
 * the same green on purpose. They are the same idea — this went well — and the
 * design system's whole position on semantic colour is that it means one thing.
 */
export const ledgerTints = {
  income: { light: colors.light.success, dark: colors.dark.success },
  expense: { light: colors.light.error, dark: colors.dark.error },
  savings: { light: colors.light.info, dark: colors.dark.info },
} as const satisfies Record<string, TintPair>;

/**
 * How a goal is tracking against its own deadline: ahead, on track, behind.
 *
 * A ladder, not three unrelated colours — and deliberately the semantic set
 * rather than module tints, because "behind" has to read as caution wherever
 * it appears. `none` takes the neutral: a goal with no pace yet is not a
 * warning about anything.
 */
export const paceTints = {
  ahead: { light: colors.light.success, dark: colors.dark.success },
  on_track: { light: colors.light.info, dark: colors.dark.info },
  behind: { light: colors.light.warning, dark: colors.dark.warning },
  none: moduleTints.settings,
} as const satisfies Record<string, TintPair>;

/** Resolve a module tint for the active theme in one call. */
export function moduleTint(name: ModuleName, theme: ThemeName): string {
  return moduleTints[name][theme];
}

/**
 * The same tint, adjusted until it is legible as TEXT on that theme's card.
 *
 * `moduleTint` is a fill color and is judged against the 3:1 bar for graphics —
 * correctly, for rings, tiles and chart series. Used for a label on a card it
 * has to clear 4.5:1 instead, and on light grounds most of these did not come
 * close (water 2.43:1, habit 2.54:1, fitness 2.80:1). Derived rather than
 * hand-tuned so the pair can't drift, and so a twelfth module can't be added
 * without a readable variant. See lib/color.ts → readableOn.
 *
 * Rule of thumb: `moduleTint` for anything you fill, `moduleTintText` for
 * anything you read.
 */
export function moduleTintText(name: ModuleName, theme: ThemeName): string {
  return moduleTintsOnCard[theme][name];
}

/** Precomputed at module load — this is called from render paths. */
const moduleTintsOnCard: Record<ThemeName, Record<ModuleName, string>> = {
  light: Object.fromEntries(
    (Object.keys(moduleTints) as ModuleName[]).map((name) => [
      name,
      readableOn(moduleTints[name].light, colors.light.card, 4.5),
    ]),
  ) as Record<ModuleName, string>,
  dark: Object.fromEntries(
    (Object.keys(moduleTints) as ModuleName[]).map((name) => [
      name,
      readableOn(moduleTints[name].dark, colors.dark.card, 4.5),
    ]),
  ) as Record<ModuleName, string>,
};

/**
 * Any one-off tint made legible on the current card — for colors that come from
 * user data (task categories, habit categories) rather than the module table,
 * and so cannot be precomputed.
 */
export function readableTint(hex: string, theme: ThemeName, minRatio = 4.5): string {
  const key = `${hex}|${theme}|${minRatio}`;
  const hit = readableTintCache.get(key);
  if (hit !== undefined) return hit;
  const value = readableOn(hex, colors[theme].card, minRatio);
  readableTintCache.set(key, value);
  return value;
}

/**
 * `readableOn` walks up to twenty mixes looking for the first shade that
 * clears the ratio, and this is called from render — once per habit row, once
 * per note card, on every re-render and every frame of a list scroll. The
 * module tints get the same treatment by being precomputed at module load;
 * user-chosen colours can't be, because they aren't known until the row exists.
 *
 * Unbounded on purpose. The key space is (colour the user picked) × 2 themes ×
 * (the two ratios anything asks for), and the palette they pick from has six
 * entries — this tops out at a few dozen strings for the life of the process.
 */
const readableTintCache = new Map<string, string>();

/** Categorical chart palette — ordered so adjacent series stay distinct.
 *  Feed the light or dark row to charts based on the active theme. */
export const chartSeries = {
  light: ['#10b981', '#3b82f6', '#8b5cf6', '#f97316', '#06b6d4', '#f43f5e', '#6366f1'],
  dark: ['#34d399', '#60a5fa', '#a78bfa', '#fb923c', '#22d3ee', '#fb7185', '#818cf8'],
} as const;

// ---------------------------------------------------------------------------
// TYPOGRAPHY — Sora for all chrome; Literata (serif) reserved for Journal's
// written content so writing reads literary rather than form-filling.
// Sizes in px; lineHeight in px; letterSpacing in px (RN units).
// ---------------------------------------------------------------------------

export const fontFamily = {
  regular: 'Sora_400Regular',
  medium: 'Sora_500Medium',
  semibold: 'Sora_600SemiBold',
  bold: 'Sora_700Bold',
  extrabold: 'Sora_800ExtraBold',
  serif: 'Literata_400Regular',
  serifItalic: 'Literata_400Regular_Italic',
  serifMedium: 'Literata_500Medium',
  serifSemibold: 'Literata_600SemiBold',
} as const;

/** The type scale. `family` names the intended Sora weight; `tracking` is in px
 *  (negative tightens display sizes, positive opens up small uppercase labels). */
export const typography = {
  display: { size: 40, lineHeight: 44, family: fontFamily.extrabold, tracking: -0.8 },
  h1: { size: 30, lineHeight: 36, family: fontFamily.extrabold, tracking: -0.5 },
  h2: { size: 24, lineHeight: 30, family: fontFamily.bold, tracking: -0.4 },
  h3: { size: 20, lineHeight: 26, family: fontFamily.semibold, tracking: -0.2 },
  title: { size: 17, lineHeight: 24, family: fontFamily.semibold, tracking: -0.1 },
  bodyLg: { size: 17, lineHeight: 26, family: fontFamily.regular, tracking: 0 },
  body: { size: 15, lineHeight: 23, family: fontFamily.regular, tracking: 0 },
  label: { size: 13, lineHeight: 18, family: fontFamily.semibold, tracking: 0 },
  caption: { size: 12, lineHeight: 16, family: fontFamily.regular, tracking: 0.1 },
  micro: { size: 11, lineHeight: 14, family: fontFamily.medium, tracking: 0.4 }, // uppercase eyebrows
  // Numeric readouts (streaks, water ml, stats) want tabular alignment & tight tracking.
  stat: { size: 34, lineHeight: 38, family: fontFamily.extrabold, tracking: -1 },
  statSm: { size: 22, lineHeight: 26, family: fontFamily.bold, tracking: -0.5 },
} as const;

// ---------------------------------------------------------------------------
// SPACING — 8-point rhythm on a 4px base. Keys are the multiple of 4px.
// ---------------------------------------------------------------------------

export const spacing = {
  0: 0,
  0.5: 2,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
  20: 80,
  24: 96,
} as const;

/** Layout constants that repeat across screens. */
export const layout = {
  screenPaddingX: spacing[5], // 20 — comfortable gutters, thumb-safe
  cardPadding: spacing[4], // 16
  cardPaddingLg: spacing[5], // 20 — hero cards
  sectionGap: spacing[6], // 24 — between dashboard sections
  listRowGap: spacing[3], // 12
  fieldGap: spacing[4], // 16 — form rows
  sheetPadding: spacing[5], // 20
  tabBarHeight: 64,
  fabSize: 56,
  minTouchTarget: 44, // never smaller — accessibility floor
} as const;

// ---------------------------------------------------------------------------
// RADIUS — soft but not pill-everywhere. `full` reserved for buttons/pills/FAB.
// ---------------------------------------------------------------------------

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  '2xl': 28, // the card radius — every resting card surface in the app
  '3xl': 32, // large squares only (80pt+ icon plinths, 160pt media tiles)
  full: 9999,
} as const;

// ---------------------------------------------------------------------------
// ELEVATION — the spatial stack. Neutral shadows for chrome; use glowShadow()
// from lib/color.ts for colored/module surfaces. Values tuned to stay soft on
// light and to read as depth (not haze) on dark. `elevation` is Android-only.
// ---------------------------------------------------------------------------

export const elevation = {
  e0: {
    shadowColor: '#000',
    shadowOpacity: 0,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 0 },
    elevation: 0,
  },
  e1: {
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  e2: {
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  e3: {
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  e4: {
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 32,
    shadowOffset: { width: 0, height: 16 },
    elevation: 16,
  },
} as const;

export type ElevationLevel = keyof typeof elevation;

// ---------------------------------------------------------------------------
// OPACITY — interaction & state.
// ---------------------------------------------------------------------------

export const opacity = {
  disabled: 0.4, // matches Button's disabled:opacity-40
  pressedOverlay: 0.08,
  muted: 0.6,
  scrim: 0.5, // modal / sheet backdrop
  ghostHover: 0.06,
} as const;

// ---------------------------------------------------------------------------
// MOTION — purpose before decoration. Durations in ms. Springs feed Reanimated
// withSpring; timings feed withTiming with the matching easing (see notes).
// Always gate celebratory / non-essential motion behind reduced-motion.
// ---------------------------------------------------------------------------

export const motion = {
  duration: {
    instant: 100, // state flips (checkbox tick, toggle)
    fast: 160, // press feedback, small fades
    base: 220, // most enter/exit, card expand
    slow: 320, // page transitions, sheet present
    slower: 480, // progress ring sweeps, celebratory reveals
  },
  /** Reanimated spring presets. `press` matches the Button press-in feel. */
  spring: {
    press: { damping: 16, stiffness: 400 }, // snappy tap-down
    release: { damping: 12, stiffness: 300 }, // soft settle back
    gentle: { damping: 18, stiffness: 180 }, // sheets, reorder
    bouncy: { damping: 10, stiffness: 220 }, // streak celebration only
  },
  /** Easing bezier control points — pair with react-native-reanimated Easing.bezier. */
  easing: {
    standard: [0.2, 0, 0, 1], // default enter+exit, "expressive standard"
    decelerate: [0, 0, 0, 1], // enter (comes to rest)
    accelerate: [0.3, 0, 1, 1], // exit (leaves screen)
  },
} as const;

// ---------------------------------------------------------------------------
// Convenience: the full token bundle for a given theme, for ergonomic imports
// in native code (`const t = tokens('dark')`).
// ---------------------------------------------------------------------------

export function tokens(theme: ThemeName) {
  return {
    colors: colors[theme],
    module: (name: ModuleName) => moduleTints[name][theme],
    chart: chartSeries[theme],
    typography,
    spacing,
    layout,
    radius,
    elevation,
    opacity,
    motion,
    fontFamily,
  } as const;
}
