import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { colors } from '@/constants/design-tokens';

const ROOT = join(__dirname, '..', '..');

/** Comments discuss these values in prose; the assertions are about code. */
const readCode = (relative: string) =>
  readFileSync(join(ROOT, relative), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

function sourceFiles(...directories: string[]): string[] {
  const out: string[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry)) out.push(path);
    }
  };
  for (const directory of directories) walk(join(ROOT, directory));
  return out;
}

const input = readCode('components/ui/input.tsx');
const text = readCode('components/ui/text.tsx');

/** Matches the JSX form (`={1.4}`) and the props-object form (`: 1.4`). */
const capOf = (source: string) => source.match(/maxFontSizeMultiplier(?:=\{|:\s*)([\d.]+)/)?.[1];

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

describe('every field in the app goes through Input', () => {
  /*
   * `components` is in this list, and its absence was a real blind spot rather
   * than an oversight of scope: `components/ui/category-picker.tsx` held a raw
   * `TextInput` the entire time this suite claimed there were none left. It is
   * a shared control used by tasks and notes, so it appeared on more screens
   * than most of the fields the guard did cover — and it carried the platform's
   * own emerald underline into a rounded pill on Android because of it.
   *
   * `input.tsx` itself is excluded below, being the one file allowed to render
   * the element.
   */
  const screens = sourceFiles('app', 'features', 'components').filter(
    (path) => !path.endsWith(join('components', 'ui', 'input.tsx')),
  );

  it('leaves no raw TextInput or BottomSheetTextInput', () => {
    /*
     * All 110 were hand-assembled, which is why every field-level concern was a
     * repeated omission rather than one bug. An eleventh-hundred-and-eleventh
     * hand-rolled field would reintroduce the whole set, so it fails here first.
     *
     * `as={BottomSheetTextInput}` covers the eight fields inside sheets: a plain
     * TextInput in a bottom sheet does not lift itself above the keyboard, so
     * the element has to differ even though nothing else does.
     */
    const offenders = screens.filter((path) =>
      /<(BottomSheet)?TextInput[\s/>]/.test(readFileSync(path, 'utf8')),
    );
    expect(offenders.map((p) => p.slice(ROOT.length + 1))).toEqual([]);
  });

  it('leaves no hand-typed placeholderTextColor', () => {
    // It was right in all 117 uses, but only because three cohorts of
    // copy-paste agreed on `mutedForeground` — spelled three different ways.
    // Nothing would have caught the 118th.
    const offenders = screens.filter((path) =>
      /placeholderTextColor/.test(readFileSync(path, 'utf8')),
    );
    expect(offenders.map((p) => p.slice(ROOT.length + 1))).toEqual([]);
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

  it('shows focus on the border alone, with no tinted fill behind the field', () => {
    /*
     * Focus used to be the border *plus* a halo: a wrapper whose always-present
     * 2px padding filled with 18% `ring` while focused. On the near-white
     * onboarding and sign-in screens that band did not read as a glow around
     * the field — it read as a green shade leaking out of one, which is what it
     * was reported as. Every field in the app comes through this component, so
     * it looked like a rendering fault on all 80 field-bearing files at once.
     *
     * Asserted as "nothing paints a fill from `focused`" rather than as the
     * absence of one expression, because the halo was a `backgroundColor` on a
     * wrapper and the next one would be just as easy to reach for.
     */
    expect(input).not.toMatch(/backgroundColor: focused/);
    expect(input).not.toMatch(/alpha\(/);
    expect(input).toMatch(/focused \? c\.ring/);
  });

  it('never grows the border on focus, which would shift every field below it', () => {
    /*
     * The halo existed for a real reason, and dropping it does not repeal that
     * reason: React Native's box model puts the border inside the height, so a
     * field that thickens its own border on focus grows 2px taller and nudges
     * every field under it down. Colour is the only property of the border that
     * is free to change here.
     */
    expect(input).not.toMatch(/borderWidth: focused/);
    expect(input).not.toMatch(/focused \? 'border-2'/);
  });

  it("suppresses Android's own underline, which is tinted with the accent", () => {
    /*
     * The other green artefact, and a different one from the focus fill
     * removed above — this one is the platform's, not ours.
     *
     * Android draws an underline behind every `TextInput`, tinted with the
     * platform accent — emerald here. Inside our own rounded bordered surface
     * that shows as a green line across the bottom of the field, and on focus
     * as a wash bleeding past its edge. Two focus indicators, one of them not
     * ours, neither agreeing with the other.
     *
     * Set on the shared props rather than per call site: 75 fields were
     * hand-rolled before this component existed, and a detail every call site
     * has to remember is one most of them will not.
     */
    expect(input).toMatch(/underlineColorAndroid: 'transparent'/);
  });
});
