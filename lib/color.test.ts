import {
  colors,
  moduleTint,
  moduleTintText,
  moduleTints,
  readableTint,
  type ModuleName,
  type ThemeName,
} from '@/constants/design-tokens';
import {
  contrastRatio,
  readableOn,
  relativeLuminance,
  tintGradient,
  tintGradientTriple,
} from '@/lib/color';
import { categoryColorPalette, priorityColors, habitDoneColor } from '@/constants/theme';

const MODULES = Object.keys(moduleTints) as ModuleName[];
const THEMES: ThemeName[] = ['light', 'dark'];

/** WCAG AA for body text; the bar every colored label in the app has to clear. */
const AA_TEXT = 4.5;
/** WCAG AA for graphics and large text — the bar for fills, rings and icons. */
const AA_GRAPHIC = 3;

describe('contrastRatio', () => {
  it('is 21 for black on white and 1 for a color on itself', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#3b82f6', '#3b82f6')).toBeCloseTo(1, 5);
  });

  it('is symmetric', () => {
    expect(contrastRatio('#10b981', '#ffffff')).toBeCloseTo(
      contrastRatio('#ffffff', '#10b981'),
      10,
    );
  });

  it('matches known reference values', () => {
    // Spot-checked against the WCAG formula; these are the ones that were
    // failing in the app before readableOn existed.
    expect(contrastRatio('#f59e0b', '#f8fbf9')).toBeCloseTo(2.06, 1);
    expect(contrastRatio('#eab308', '#ffffff')).toBeCloseTo(1.92, 1);
    expect(contrastRatio('#22c55e', '#ffffff')).toBeCloseTo(2.28, 1);
  });
});

describe('relativeLuminance', () => {
  it('bounds at black and white', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 6);
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 6);
  });
});

describe('readableOn', () => {
  it('leaves a color alone when it already passes', () => {
    expect(readableOn('#000000', '#ffffff', AA_TEXT)).toBe('#000000');
  });

  it('darkens on light grounds and lightens on dark ones', () => {
    const onLight = readableOn('#eab308', '#ffffff', AA_TEXT);
    const onDark = readableOn('#4d7c0f', '#0e1210', AA_TEXT);
    expect(relativeLuminance(onLight)).toBeLessThan(relativeLuminance('#eab308'));
    expect(relativeLuminance(onDark)).toBeGreaterThan(relativeLuminance('#4d7c0f'));
  });

  it('reaches the requested ratio for every hue', () => {
    for (const hex of ['#eab308', '#22c55e', '#06b6d4', '#f97316', '#f43f5e', '#a3e635']) {
      for (const background of ['#ffffff', '#0e1210', '#1a201d', '#f8fbf9']) {
        expect(
          contrastRatio(readableOn(hex, background, AA_TEXT), background),
        ).toBeGreaterThanOrEqual(AA_TEXT);
      }
    }
  });
});

describe('module tints', () => {
  it.each(THEMES)('fills clear the graphics bar on %s cards', (theme) => {
    for (const name of MODULES) {
      const ratio = contrastRatio(moduleTint(name, theme), colors[theme].card);
      expect({ name, theme, ratio }).toMatchObject({ name, theme });
      expect(ratio).toBeGreaterThanOrEqual(AA_GRAPHIC);
    }
  });

  it.each(THEMES)('text variants clear the body-text bar on %s cards', (theme) => {
    for (const name of MODULES) {
      const ratio = contrastRatio(moduleTintText(name, theme), colors[theme].card);
      // Named in the failure output so a regression says which module broke.
      expect(`${name}:${ratio.toFixed(2)}`).toBe(`${name}:${Math.max(ratio, AA_TEXT).toFixed(2)}`);
    }
  });

  it.each(THEMES)('text variants also clear it on the %s background', (theme) => {
    for (const name of MODULES) {
      const ratio = contrastRatio(moduleTintText(name, theme), colors[theme].background);
      expect(ratio).toBeGreaterThanOrEqual(AA_GRAPHIC);
    }
  });

  it('keeps every module hue distinguishable from its neighbours', () => {
    // Two modules that read as the same color defeat the point of having one
    // tint per life area.
    for (const theme of THEMES) {
      const seen = new Map<string, ModuleName>();
      for (const name of MODULES) {
        const hex = moduleTint(name, theme);
        expect(seen.has(hex)).toBe(false);
        seen.set(hex, name);
      }
    }
  });
});

describe('user-content palettes', () => {
  it('every category swatch has a legible text form in both themes', () => {
    for (const swatch of categoryColorPalette) {
      for (const theme of THEMES) {
        expect(
          contrastRatio(readableTint(swatch, theme), colors[theme].card),
        ).toBeGreaterThanOrEqual(AA_TEXT);
      }
    }
  });

  it('priority colors are legible as text in both themes', () => {
    for (const hex of Object.values(priorityColors)) {
      for (const theme of THEMES) {
        expect(contrastRatio(readableTint(hex, theme), colors[theme].card)).toBeGreaterThanOrEqual(
          AA_TEXT,
        );
      }
    }
  });

  it('habit-done green is legible as text in both themes', () => {
    for (const theme of THEMES) {
      expect(
        contrastRatio(readableTint(habitDoneColor, theme), colors[theme].card),
      ).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });
});

describe('gradient surfaces carry white text', () => {
  // Every gradient surface in the app — Hub tiles, HeroCard, GradientButton —
  // paints its label in white. That was safe for three of the sixteen module
  // tints and no others: white ran at 3.36–4.47:1 on the rest, because the
  // tints are tuned to clear 3:1 as FILLS on a white card, which is a laxer bar
  // than acting as the GROUND for white text.
  //
  // The fix lives in the gradient rather than the label, so the white-on-colour
  // language survives and no hue moves. These tests are what hold that: a new
  // module tint gets an ink-safe gradient for free and cannot ship without one.
  const everyTint = MODULES.flatMap((name) => THEMES.map((theme) => moduleTint(name, theme)));

  it('keeps white legible on every stop of the two-stop gradient', () => {
    for (const tint of everyTint) {
      for (const stop of tintGradient(tint)) {
        expect(contrastRatio('#ffffff', stop)).toBeGreaterThanOrEqual(AA_TEXT);
      }
    }
  });

  it('keeps white legible on every stop of the three-stop hero wash', () => {
    for (const tint of everyTint) {
      for (const stop of tintGradientTriple(tint)) {
        expect(contrastRatio('#ffffff', stop)).toBeGreaterThanOrEqual(AA_TEXT);
      }
    }
  });

  it('leaves a tint alone when it is already dark enough', () => {
    // Self-limiting, and this is the assertion that proves it: study and
    // gallery already carried white, so darkening them would be a gratuitous
    // change to two modules to fix fourteen others.
    for (const name of ['study', 'gallery'] as const) {
      const tint = moduleTint(name, 'light');
      expect(tintGradientTriple(tint)[1]).toBe(tint);
    }
  });

  it('does not shift the hue while darkening', () => {
    // Darkening is a mix toward black, which preserves hue by construction.
    // Asserted anyway: swapping in an HSL-based "darken" that clamps lightness
    // would quietly rotate a module's identity colour.
    //
    // Restricted to the chromatic tints. `settings` is a near-neutral grey
    // (channels within ~7 of each other), and hue is numerically unstable at
    // that saturation — 8-bit rounding alone moves its computed hue by 4°,
    // which is an artefact of the measurement, not a colour anyone can see.
    const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const saturation = (hex: string) => {
      const c = channels(hex);
      return Math.max(...c) - Math.min(...c);
    };
    const hue = (hex: string) => {
      const [r, g, b] = channels(hex);
      const max = Math.max(r, g, b);
      const delta = max - Math.min(r, g, b);
      if (delta === 0) return 0;
      const h =
        max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
      return (h * 60 + 360) % 360;
    };

    const chromatic = everyTint.filter((tint) => saturation(tint) > 0.1);
    expect(chromatic.length).toBeGreaterThan(25); // guard against the filter eating everything

    for (const tint of chromatic) {
      const base = tintGradientTriple(tint)[1];
      const drift = Math.abs(hue(base) - hue(tint));
      expect(`${tint}:${Math.min(drift, 360 - drift) < 1}`).toBe(`${tint}:true`);
    }
  });
});

describe('readableTint memoisation', () => {
  it('returns the same value on repeat calls', () => {
    // The cache is keyed on colour + theme + ratio; a miss on any of those
    // would silently return a different shade for the same input.
    for (const theme of THEMES) {
      for (const hex of ['#eab308', '#22c55e', '#8b5cf6']) {
        const first = readableTint(hex, theme);
        expect(readableTint(hex, theme)).toBe(first);
        expect(readableTint(hex, theme)).toBe(first);
      }
    }
  });

  it('does not confuse different ratios for the same colour', () => {
    // 3:1 and 4.5:1 want different shades of the same hue. A cache keyed only
    // on colour+theme would hand the graphics bar a body-text colour.
    const graphic = readableTint('#eab308', 'light', 3);
    const text = readableTint('#eab308', 'light', 4.5);
    expect(contrastRatio(graphic, colors.light.card)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(text, colors.light.card)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(graphic).not.toBe(text);
  });

  it('does not confuse the two themes', () => {
    expect(readableTint('#22c55e', 'light')).not.toBe(readableTint('#22c55e', 'dark'));
  });
});

describe('progress ring halo geometry', () => {
  // The ring's glow is a wider stroke on the same circle, so the radius has to
  // reserve half of the widest halo. Get that wrong and the halo clips against
  // the SVG bounds, which reads as the ring being sliced flat — worse than no
  // glow. These are the sizes the app actually renders; the invariant is
  // arithmetic, so it belongs in a test rather than in a comment.
  const HALO_OUTER = 2.2;
  const RINGS = [
    { size: 80, strokeWidth: 8 }, // dashboard hero, three up
    { size: 158, strokeWidth: 13 }, // goal detail
    { size: 160, strokeWidth: 12 }, // ProgressRing default
    { size: 168, strokeWidth: 14 }, // study
    { size: 172, strokeWidth: 14 }, // sleep
  ];

  it.each(RINGS)(
    'halo stays inside the viewport at $size/$strokeWidth',
    ({ size, strokeWidth }) => {
      const outer = strokeWidth * HALO_OUTER;
      const radius = (size - outer) / 2;
      expect(radius + outer / 2).toBeLessThanOrEqual(size / 2);
      // And the arc must still be a ring, not a filled disc.
      expect(radius).toBeGreaterThan(strokeWidth);
    },
  );
});
