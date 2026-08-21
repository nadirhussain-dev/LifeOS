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
import { relative } from 'node:path';
import { readFileSync } from 'node:fs';

import {
  ROOT,
  contrastRatio,
  hexToHsl,
  hslMatches,
  readCssVars,
  readModuleTints,
  readTailwindKeys,
  sourceFiles,
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

/*
 * ── Call sites ───────────────────────────────────────────────────────────────
 *
 * The three checks above prove the token layers agree with EACH OTHER. Nothing
 * proved the screens agree with the tokens, and they had drifted badly: sixteen
 * files declared their module's tint as a module-level hex literal instead of
 * reading it, and because a literal has no light/dark pair, each pinned one
 * value across both themes. Three of them pinned the wrong one — Study wore
 * `#8b5cf6`, which is its own *dark* value and Journal's *light* one, so on the
 * light theme Study and Journal were the identical violet the token file had
 * been retuned specifically to separate.
 *
 * So this looks for the two shapes that betray a re-typed token.
 */
const registered = new Map();
for (const [name, pair] of Object.entries(modules)) {
  for (const theme of ['light', 'dark']) {
    registered.set(pair[theme].toLowerCase(), `moduleTints.${name}.${theme}`);
  }
}

for (const file of sourceFiles('app', 'features')) {
  const code = readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
  const where = relative(ROOT, file);

  // 1. The shadow-tint shape: a module-level constant holding a raw colour.
  //    This is what made the drift invisible — it reads like a token.
  for (const [, name] of code.matchAll(/^const ([A-Z_]*TINT[A-Z_]*) = '#[0-9a-fA-F]{3,8}';/gm)) {
    fail(`${where}: \`${name}\` is a hardcoded tint. Use a TintPair so it retunes for dark.`);
  }

  // 2. A hex that IS a registered tint. If it matches a token exactly, the
  //    token is what was meant — and only the token follows the theme.
  for (const [, hex] of code.matchAll(/['"](#[0-9a-fA-F]{6})['"]/g)) {
    const token = registered.get(hex.toLowerCase());
    if (token) fail(`${where}: '${hex}' is ${token}. Import the tint instead of re-typing it.`);
  }
}

if (failures.length > 0) {
  console.error(`\nToken layers disagree (${failures.length}):\n`);
  for (const f of failures) console.error(`  - ${f}`);
  console.error('\nglobal.css, tailwind.config.js and constants/design-tokens.ts');
  console.error('must all describe the same colour, and screens must read it');
  console.error('from them rather than re-typing the value.\n');
  process.exit(1);
}

const count = Object.keys(modules).length;
console.log(`Token layers agree across ${count} module tints, both themes,`);
console.log('and no screen re-types a registered tint.');
