/**
 * Small color helpers for the premium gradient design language. Every module
 * carries one signature tint; these derive the lighter/darker stops, soft
 * tinted backgrounds and glow shadows from that single hex so a module's whole
 * look stays coherent from one value.
 */

function clamp(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = hex.replace('#', '');
  const full =
    normalized.length === 3
      ? normalized
          .split('')
          .map((c) => c + c)
          .join('')
      : normalized;
  const int = parseInt(full, 16);
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => clamp(v).toString(16).padStart(2, '0')).join('')}`;
}

/** Mixes `hex` toward `target` by `amount` (0–1). */
function mix(hex: string, target: string, amount: number): string {
  const a = hexToRgb(hex);
  const b = hexToRgb(target);
  return rgbToHex(
    a.r + (b.r - a.r) * amount,
    a.g + (b.g - a.g) * amount,
    a.b + (b.b - a.b) * amount,
  );
}

export function lighten(hex: string, amount: number): string {
  return mix(hex, '#ffffff', amount);
}

export function darken(hex: string, amount: number): string {
  return mix(hex, '#000000', amount);
}

/**
 * The darkest a tint has to get before white text on it clears `minRatio`.
 *
 * The module tints are tuned to clear 3:1 as *fills on a white card* — a ring,
 * a dot, a chart series. Painting one as the *background* for white text is a
 * different and stricter job, and 13 of the 16 did not clear AA at it: habit
 * 3.77, calendar 3.68, recovery 3.36, and so on down. That gap survived every
 * audit of the token table because it isn't a property of the tint, it's a
 * property of the gradient derived from it at render time.
 *
 * Measured against the LIGHTEST stop, since that is the worst case and the one
 * the icon chip sits on. Self-limiting by construction: a tint that already
 * clears the bar (study, gallery) is returned untouched, so this darkens only
 * what has to be darkened and never drifts a hue.
 */
function inkSafe(hex: string, minRatio: number): string {
  for (let amount = 0; amount <= 0.9; amount += 0.02) {
    const base = darken(hex, amount);
    if (contrastRatio('#ffffff', lighten(base, 0.18)) >= minRatio) return base;
  }
  return darken(hex, 0.9);
}

/** Two-stop gradient derived from a module tint: a brighter top-left flowing
 * into a deeper bottom-right, for hero cards, rings and FAB-like surfaces.
 *
 * Content on these is white, so the base is first driven dark enough to carry
 * it — see `inkSafe`. */
export function tintGradient(hex: string): [string, string] {
  const base = inkSafe(hex, 4.5);
  return [lighten(base, 0.12), darken(base, 0.24)];
}

/** Even richer three-stop gradient for large hero washes. */
export function tintGradientTriple(hex: string): [string, string, string] {
  const base = inkSafe(hex, 4.5);
  return [lighten(base, 0.18), base, darken(base, 0.28)];
}

/** Alpha-suffixed hex for subtle tinted fills (e.g. `${tint}1f`). `a` is 0–1. */
export function alpha(hex: string, a: number): string {
  const value = clamp(a * 255)
    .toString(16)
    .padStart(2, '0');
  return `${hex}${value}`;
}

// ---------------------------------------------------------------------------
// Contrast
//
// The module tints are chosen to look right as *fills* — a progress ring, a
// gradient tile, a chart series — where the bar is 3:1 and they clear it
// comfortably. Several of them then got reused as the color of small text on a
// white card, where the bar is 4.5:1 and they were nowhere near it: the journal
// streak label ran at 2.06:1, the notes tint at 1.92:1, habit-done green at
// 2.19:1. All three are legible to the person who picked them and hard work for
// everybody else.
//
// Rather than hand-pick a second hex per module and hope the pairs stay in step,
// derive it: keep the tint for fills and darken (or lighten, on dark grounds)
// a copy of it until it actually clears the ratio. A new module tint then gets a
// legible text variant for free, and cannot ship without one.
// ---------------------------------------------------------------------------

/** WCAG relative luminance. */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio between two opaque colors: 1 (identical) to 21. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * The nearest version of `hex` that reads at `minRatio` against `background`.
 *
 * Moves toward black on light grounds and toward white on dark ones, in small
 * steps, and stops at the first shade that clears — so the result keeps as much
 * of the original hue and saturation as legibility allows rather than collapsing
 * to a safe grey. Falls back to plain black/white in the rare case where even a
 * full mix cannot reach the target.
 *
 * 4.5:1 is the WCAG AA bar for body text; pass 3 for large text and icons.
 */
export function readableOn(hex: string, background: string, minRatio = 4.5): string {
  if (contrastRatio(hex, background) >= minRatio) return hex;

  const backgroundIsDark = relativeLuminance(background) < 0.5;
  const target = backgroundIsDark ? '#ffffff' : '#000000';

  for (let amount = 0.05; amount <= 1; amount += 0.05) {
    const candidate = mix(hex, target, amount);
    if (contrastRatio(candidate, background) >= minRatio) return candidate;
  }
  return target;
}

/** Shared soft-glow shadow for elevated colored surfaces. */
export function glowShadow(hex: string, opacity = 0.35) {
  return {
    shadowColor: hex,
    shadowOpacity: opacity,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  } as const;
}
