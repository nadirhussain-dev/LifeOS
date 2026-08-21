import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');

function sourceFiles(...directories: string[]): string[] {
  const out: string[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(path);
    }
  };
  for (const directory of directories) walk(join(ROOT, directory));
  return out;
}

const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

/**
 * Indefinite motion that is deliberately NOT gated, with the reason.
 *
 * Keep this list short and argued. Anything here is a considered exemption, not
 * a backlog: adding a file to it should require the same justification the entry
 * below carries.
 */
const EXEMPT = new Map([
  [
    'features/private/components/vault-seal-transition.tsx',
    // The rotating ring is the only signal that PBKDF2 is running. Freezing it
    // reproduces the "reads as broken" failure the component exists to prevent,
    // and on the vault the alternative reading is "your key was rejected". An
    // indeterminate spinner is the standard exemption for essential feedback —
    // the platform's own ActivityIndicator keeps spinning under the setting.
    // The decorative breathing orb in the same file IS gated.
    'indeterminate progress for a deliberately slow KDF',
  ],
]);

describe('indefinite animation respects reduced motion', () => {
  const offenders: string[] = [];

  for (const path of sourceFiles('app', 'features', 'components')) {
    const code = stripComments(readFileSync(path, 'utf8'));
    // `withRepeat(…, -1, …)` — loops until unmounted, the category the setting
    // is aimed at. Finite springs and one-shot entrances are out of scope.
    if (!/withRepeat\s*\([\s\S]{0,400}?,\s*-1/.test(code)) continue;

    const relative = path.slice(ROOT.length + 1);
    if (EXEMPT.has(relative)) continue;
    if (!/useReducedMotion/.test(code)) offenders.push(relative);
  }

  it('gates every indefinite loop, or exempts it on the record', () => {
    /*
     * The hook existed and was read by 22 surfaces, but the four loudest
     * animations in the app were the four that skipped it: music's three-layer
     * full-screen aurora (11s/15s/19s), the artwork orb's spin and breath, the
     * equalizer, and the vault's decorative pulse. The pass that introduced the
     * hook fixed the celebratory bursts and missed the ambient loops — which are
     * worse, because a burst ends on its own and an aurora does not.
     *
     * As the hook's own docstring puts it: for a vestibular disorder that
     * setting is not a preference, it is the difference between using the app
     * and feeling ill.
     */
    expect(offenders).toEqual([]);
  });
});
