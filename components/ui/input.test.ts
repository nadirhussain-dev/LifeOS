import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { colors } from '@/constants/design-tokens';

const ROOT = join(__dirname, '..', '..');

/** Comments discuss these values in prose; the assertions are about code. */
const readCode = (relative: string) =>
  readFileSync(join(ROOT, relative), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

const input = readCode('components/ui/input.tsx');
const text = readCode('components/ui/text.tsx');

const capOf = (source: string) => source.match(/maxFontSizeMultiplier=\{([\d.]+)\}/)?.[1];

describe('Input dynamic type', () => {
  it('caps at the same multiplier as Text, so a label and its field scale together', () => {
    // The whole bug this component was written for: Text capped at 1.4 and none
    // of the 110 hand-rolled inputs capped at all, so at the largest OS text
    // size a field's value outgrew its own label and overflowed the
    // fixed-height control the cap exists to protect. If these two ever drift
    // apart again, that returns silently — nothing else would catch it.
    expect(capOf(input)).toBeDefined();
    expect(capOf(input)).toBe(capOf(text));
  });
});

describe('Input token consumption', () => {
  it('is the consumer of --ring and --input', () => {
    // Both tokens were defined in all three layers (global.css, tailwind
    // config, design-tokens) and consumed by nothing, while all 223 field
    // borders used `border-border`. This component is what makes them real; a
    // refactor that quietly drops them puts the app back to having a token
    // layer that describes a state the UI never renders.
    expect(input).toContain('c.ring');
    expect(input).toContain('c.input');
  });

  it('has a focus state distinct from its resting and invalid states', () => {
    // Before this, four of 75 input-bearing files had an `onFocus` at all and
    // two used it to scroll — so nothing on a multi-field form said where the
    // keyboard was pointed.
    expect(input).toMatch(/onFocus/);
    expect(input).toMatch(/setFocused\(true\)/);
    expect(input).toMatch(/setFocused\(false\)/);

    const resting = colors.light.input;
    const focus = colors.light.ring;
    const invalid = colors.light.error;
    expect(new Set([resting, focus, invalid]).size).toBe(3);
  });

  it('stays on the radius scale', () => {
    /*
     * This component was first written with `rounded-[14px]`, an off-scale
     * literal — which is precisely what it exists to stop other people writing,
     * and it silently changed AuthField's corners from 28 to 14 on the way past.
     *
     * The `field` surface is now exactly `cardClass({ padding: 'row' })`, the
     * shape 29 of the hand-rolled inputs already drew themselves as, so they
     * migrate with no visual change at all.
     */
    expect(input).not.toMatch(/rounded-\[/);
    expect(input).toContain("'rounded-2xl border bg-card px-4'");
    expect(input).toMatch(/py-3 font-sans text-base text-foreground/);
  });

  it('draws the focus halo with padding that is always present', () => {
    // A border that thickens on focus shifts every field below it. The halo is
    // unconditional padding whose colour changes, so focus cannot move layout.
    expect(input).toMatch(/rounded-3xl p-0\.5/);
    expect(input).toMatch(/backgroundColor: focused \?/);
  });
});
