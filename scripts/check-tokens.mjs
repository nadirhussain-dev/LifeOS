/**
 * Fails when the three token layers disagree.
 *
 * `npm run check:tokens`
 *
 * The layers are supposed to mirror each other, and nothing enforced it:
 * `gallery` and `music` sat in design-tokens.ts with no CSS variable and no
 * Tailwind entry, so every `text-gallery` in the codebase would have rendered
 * as nothing. The failure mode is silent — a missing class produces no error,
 * just an uncoloured element — which is exactly the kind of thing a person
 * stops noticing and a script does not.
 */
import {
  contrastRatio,
  hexToHsl,
  hslMatches,
  readCssVars,
  readModuleTints,
  readTailwindKeys,
} from './tokens.mjs';

const failures = [];
const fail = (message) => failures.push(message);

const css = readCssVars();
const tailwind = readTailwindKeys();
const modules = readModuleTints();

// Cards each module tint is judged against, mirroring lib/color.test.ts.
const CARD = { light: '#ffffff', dark: '#1a201d' };
/** WCAG AA for graphics — these are drawn as rings, dots and icon fills. */
const GRAPHIC_BAR = 3;

for (const [name, pair] of Object.entries(modules)) {
  // `settings` is chrome rather than a life area: neutral by design, and not
  // exposed as a Tailwind class because nothing should reach for `bg-settings`.
  if (name === 'settings') continue;

  for (const theme of ['light', 'dark']) {
    const variable = css[theme][name];
    if (!variable) {
      fail(`global.css (${theme}): --${name} is missing, but moduleTints defines it`);
      continue;
    }
    if (!hslMatches(hexToHsl(pair[theme]), variable)) {
      const want = hexToHsl(pair[theme]);
      fail(
        `--${name} (${theme}) disagrees: global.css says ` +
          `${variable.h.toFixed(0)} ${variable.s.toFixed(0)}% ${variable.l.toFixed(0)}%, ` +
          `design-tokens says ${pair[theme]} = ` +
          `${want.h.toFixed(0)} ${want.s.toFixed(0)}% ${want.l.toFixed(0)}%`,
      );
    }
  }

  if (!tailwind.has(name)) {
    fail(
      `tailwind.config.js: no \`${name}\` colour, so \`text-${name}\` / \`bg-${name}\` ` +
        `compile to nothing`,
    );
  }

  for (const theme of ['light', 'dark']) {
    const ratio = contrastRatio(pair[theme], CARD[theme]);
    if (ratio < GRAPHIC_BAR) {
      fail(
        `${name} (${theme}) is ${ratio.toFixed(2)}:1 on the ${theme} card, ` +
          `below the ${GRAPHIC_BAR}:1 bar for fills`,
      );
    }
  }
}

// The reverse direction: a CSS variable with no owner in the token file.
const KNOWN_NON_MODULE = new Set([
  'background',
  'foreground',
  'surface',
  'surface-foreground',
  'card',
  'card-foreground',
  'primary',
  'primary-foreground',
  'secondary',
  'secondary-foreground',
  'muted',
  'muted-foreground',
  'accent',
  'accent-foreground',
  'success',
  'success-foreground',
  'warning',
  'warning-foreground',
  'destructive',
  'destructive-foreground',
  'info',
  'info-foreground',
  'border',
  'input',
  'ring',
]);
for (const name of Object.keys(css.light)) {
  if (KNOWN_NON_MODULE.has(name) || modules[name]) continue;
  fail(`global.css: --${name} has no entry in moduleTints`);
}

if (failures.length > 0) {
  console.error(`\nToken layers disagree (${failures.length}):\n`);
  for (const f of failures) console.error(`  - ${f}`);
  console.error('\nglobal.css, tailwind.config.js and constants/design-tokens.ts');
  console.error('must all describe the same colour. Fix whichever is wrong.\n');
  process.exit(1);
}

const count = Object.keys(modules).length;
console.log(`Token layers agree across ${count} module tints, both themes.`);
