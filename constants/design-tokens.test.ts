import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { colors as tokens } from '@/constants/design-tokens';

/**
 * Contrast, for the text tokens.
 *
 * `npm run check:tokens` already holds the module tints together across
 * themes; what it does not ask is whether the text can be read. That gap is how
 * a token sized for inactive indicators ended up carrying prose — at 4.2:1 in
 * dark and 2.4:1 in light, neither of which a caption may be.
 *
 * WCAG 2.1 AA: 4.5:1 for normal text, 3:1 for large. Captions are small, so the
 * higher bar is the one that applies to everything asserted here.
 */

const AA_NORMAL = 4.5;

/** WCAG relative luminance for an #rrggbb string. */
function luminance(hex: string): number {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const r = channel(parseInt(hex.slice(1, 3), 16));
  const g = channel(parseInt(hex.slice(3, 5), 16));
  const b = channel(parseInt(hex.slice(5, 7), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('dark theme text', () => {
  const { background, card, surface, foreground, mutedForeground } = tokens.dark;

  it.each([
    ['foreground on background', foreground, background],
    ['foreground on card', foreground, card],
    ['mutedForeground on background', mutedForeground, background],
    ['mutedForeground on card', mutedForeground, card],
    ['mutedForeground on surface', mutedForeground, surface],
  ])('%s meets AA', (_label, ink, ground) => {
    expect(contrast(ink, ground)).toBeGreaterThanOrEqual(AA_NORMAL);
  });
});

/**
 * `subtleForeground` is deliberately below AA in both themes, because it is not
 * a text colour — see its note in design-tokens.ts. The token is fine; reaching
 * for it to colour words is what is not, and that is what this guards.
 */
describe('subtleForeground', () => {
  it('is only ever used on something other than text', () => {
    const offenders: string[] = [];
    for (const path of sourceFiles()) {
      const source = readFileSync(join(ROOT, path), 'utf8');
      let at = source.indexOf('subtleForeground');
      while (at !== -1) {
        // The JSX element this sits inside is the nearest tag opened before it.
        const opener = source.lastIndexOf('<', at);
        const tag = /^<([A-Za-z][\w.]*)/.exec(source.slice(opener, opener + 40))?.[1];
        if (tag === 'Text') offenders.push(`${path} (inside <${tag}>)`);
        at = source.indexOf('subtleForeground', at + 1);
      }
    }
    expect(offenders).toEqual([]);
  });

  /** If it ever climbs past AA the note above it is wrong, and it should just
   *  be a text colour like the others. */
  it('is still the low-contrast token it says it is', () => {
    expect(contrast(tokens.dark.subtleForeground, tokens.dark.background)).toBeLessThan(AA_NORMAL);
  });
});

const ROOT = join(__dirname, '..');

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(join(ROOT, dir))) {
      const rel = `${dir}/${entry}`;
      if (statSync(join(ROOT, rel)).isDirectory()) walk(rel);
      else if (entry.endsWith('.tsx')) out.push(rel);
    }
  };
  for (const root of ['app', 'components', 'features']) walk(root);
  return out;
}
