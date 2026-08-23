import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

const ROOT = join(__dirname, '..', '..');

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

/**
 * A repo-relative path with forward slashes, on every OS.
 *
 * `join` produces `\` on Windows, so a path compared against a hand-written
 * `'components/ui/directional-icon.ts'` never matched there — the exemption
 * silently did nothing and this suite failed on the one file it exists to
 * permit. CI runs on Linux, so it was green in the only place anybody looked
 * and red on every Windows checkout.
 */
const relativePath = (absolute: string) =>
  absolute
    .slice(ROOT.length + 1)
    .split(sep)
    .join('/');

/**
 * Files allowed to import a left/right glyph straight from lucide.
 *
 * Only the module that defines the mirrored aliases, and the transport controls
 * its own docstring exempts: play/skip follow the tape, not the script, and stay
 * left-to-right in every locale on both platforms.
 */
const EXEMPT = new Set(['components/ui/directional-icon.ts']);

describe('directional glyphs are mirrored, not raw', () => {
  it('no screen imports ChevronLeft/Right or ArrowLeft/Right from lucide', () => {
    /*
     * React Native flips layout in RTL but never icon *content*, so a raw
     * `ChevronLeft` keeps pointing left in Arabic and a back button ends up
     * aimed at the content it came from.
     *
     * Nine files were doing exactly that, and the app ships Arabic and Urdu:
     * the seven operator screens, the private space's shared shell — nineteen
     * screens through one component — and the album chat header. The month
     * stepper in cycle-month-strip was the same bug pointing at a different
     * axis: "previous month" is as directional as "back".
     */
    const offenders: string[] = [];

    for (const path of sourceFiles('app', 'features', 'components')) {
      const relative = relativePath(path);
      if (EXEMPT.has(relative)) continue;

      const code = readFileSync(path, 'utf8');
      const lucide = code.match(/import \{([^}]*)\} from 'lucide-react-native';/s);
      if (!lucide) continue;

      const raw = ['ChevronLeft', 'ChevronRight', 'ArrowLeft', 'ArrowRight'].filter((icon) =>
        new RegExp(`\\b${icon}\\b`).test(lucide[1]),
      );
      if (raw.length > 0) offenders.push(`${relative} — ${raw.join(', ')}`);
    }

    expect(offenders).toEqual([]);
  });
});
