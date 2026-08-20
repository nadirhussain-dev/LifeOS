import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { colors, moduleTints, type ThemeName } from '@/constants/design-tokens';
import { contrastRatio, inkSafeFill } from '@/lib/color';

const ROOT = join(__dirname, '..', '..');
const AA_TEXT = 4.5;
const THEMES: ThemeName[] = ['light', 'dark'];

function sourceFiles(...directories: string[]): string[] {
  const out: string[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.tsx$/.test(entry)) out.push(path);
    }
  };
  for (const directory of directories) walk(join(ROOT, directory));
  return out;
}

describe('a filled chip carries legible white', () => {
  it('holds white at AA on every module tint, in both themes', () => {
    /*
     * The bug this closes: seven screens filled a selected chip with
     * `resolveTint(tint, scheme)` and hardcoded `text-white`. Correct on light,
     * where the tints are dark — and wrong on dark, where `resolveTint` returns
     * the *bright* variant by design. White on music's dark lime (#a3e635) ran
     * at 1.3:1 and on notes' #eab308 at 1.8:1.
     */
    for (const name of Object.keys(moduleTints) as (keyof typeof moduleTints)[]) {
      for (const theme of THEMES) {
        const fill = inkSafeFill(moduleTints[name][theme]);
        expect(contrastRatio('#ffffff', fill)).toBeGreaterThanOrEqual(AA_TEXT);
      }
    }
  });

  it('leaves a tint alone when white already reads on it', () => {
    // Self-limiting, same as the gradients: this must not darken surfaces that
    // were already fine, or it becomes a gratuitous restyle of the whole app.
    const alreadyDark = moduleTints.study.light;
    expect(contrastRatio('#ffffff', alreadyDark)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(inkSafeFill(alreadyDark)).toBe(alreadyDark);
  });

  it('holds white on a user-chosen content colour too', () => {
    // Chips also take a bare hex — a savings goal's colour, an album category —
    // which has no pair and no guarantee of being dark.
    for (const theme of THEMES) {
      for (const swatch of Object.values(colors[theme])) {
        expect(contrastRatio('#ffffff', inkSafeFill(swatch))).toBeGreaterThanOrEqual(AA_TEXT);
      }
    }
  });
});

describe('no screen hand-draws a selected chip any more', () => {
  it('has no `text-white` paired with a tint fill outside Chip', () => {
    /*
     * The seven sites are migrated; this stops an eighth appearing. A selected
     * pill is one control, and it was drawn seven times with one shared bug —
     * which is the argument for the component, not just for fixing the seven.
     */
    const offenders: string[] = [];

    for (const path of sourceFiles('app')) {
      const code = readFileSync(path, 'utf8');
      if (!/text-white/.test(code)) continue;
      // The tell: a white label in the same file as a tint-coloured fill.
      if (/backgroundColor: (tint|debtTint|studyTint|resolveTint\()/.test(code)) {
        offenders.push(path.slice(ROOT.length + 1));
      }
    }

    expect(offenders).toEqual([]);
  });
});
