import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { cardClass, cardVariants } from '@/components/ui/card';

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

/** Comments discuss these class names in prose; the assertions are about markup. */
const readCode = (path: string) =>
  readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

describe('card variants', () => {
  it('puts the surface contract in every variant', () => {
    for (const padding of ['none', 'sm', 'md', 'lg', 'row', 'rowLg'] as const) {
      const classes = cardVariants({ padding }).split(' ');
      expect(classes).toEqual(
        expect.arrayContaining(['rounded-2xl', 'border', 'border-border', 'bg-card']),
      );
    }
  });

  it('emits the padding each variant replaced, so migrating a surface is a no-op', () => {
    // These pairings are the whole reason the codemod could run unattended: if
    // a variant ever stops emitting exactly what it stood in for, 144 surfaces
    // change appearance at once and nothing else would catch it.
    expect(cardVariants({ padding: 'sm' })).toContain('p-3.5');
    expect(cardVariants({ padding: 'md' })).toContain('p-4');
    expect(cardVariants({ padding: 'lg' })).toContain('p-5');
    expect(cardVariants({ padding: 'row' })).toContain('px-4 py-3');
    expect(cardVariants({ padding: 'rowLg' })).toContain('px-4 py-3.5');
    expect(cardVariants({ padding: 'none' }).trim()).toBe(
      'rounded-2xl border border-border bg-card',
    );
  });

  it('lets a caller override the surface without duplicate classes winning', () => {
    // tailwind-merge, not string concatenation — a passthrough `rounded-full`
    // has to actually replace the base radius rather than sit beside it.
    const merged = cardClass({ padding: 'md' }, 'rounded-full');
    expect(merged).toContain('rounded-full');
    expect(merged).not.toContain('rounded-2xl');
  });
});

describe('no screen hand-rolls the card surface', () => {
  // The nine legitimate exceptions, each a surface that is deliberately NOT the
  // resting card: bottom-sheet headers are rounded on the top edge only, two
  // are pills, one is a small input and one is a bottom toolbar. Listed by the
  // shape that makes them exempt rather than by file, so moving one between
  // files doesn't need this test edited.
  const NOT_A_CARD = /rounded-t-3xl|rounded-full|rounded-xl|border-t\b/;

  it('has no hand-rolled `rounded-2xl border border-border bg-card` left', () => {
    // 144 of them, replaced by `cardClass()` / `<Card>`. The point is not tidiness:
    // the old `Card` component had zero imports while every screen re-typed this
    // string, which is how the app ended up rendering three different card radii
    // (16, 24 and 28px) on a single dashboard. With one source for the base, a
    // retune is one edit — and this test is what keeps it that way.
    const offenders: string[] = [];
    for (const path of sourceFiles('app', 'features', 'components')) {
      const code = readCode(path);
      for (const [, classes] of code.matchAll(/className="([^"]*)"/g)) {
        const has = (c: string) => classes.split(/\s+/).includes(c);
        if (!has('rounded-2xl') || !has('border') || !has('border-border') || !has('bg-card')) {
          continue;
        }
        if (NOT_A_CARD.test(classes)) continue;
        offenders.push(`${path.slice(ROOT.length + 1)}: ${classes}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
