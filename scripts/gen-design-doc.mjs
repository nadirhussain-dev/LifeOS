/**
 * Regenerates the colour tables in docs/design-system.md from the token file.
 *
 * `npm run docs:design`
 *
 * The prose in that document is written by hand and stays that way. Only the
 * tables between the GENERATED markers are replaced — those had gone stale in
 * the way hand-maintained tables always do: six of the nine module hexes it
 * listed were the pre-darkening values, and it was missing seven modules
 * entirely, so anyone designing from the doc was designing from last quarter's
 * palette.
 *
 * Reads through scripts/tokens.mjs, the same parser the drift guard uses, so
 * the documentation and the check can never describe different colours.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  ROOT,
  contrastRatio,
  hexToHsl,
  hexToRgb,
  readModuleTints,
  readSemanticColors,
} from './tokens.mjs';

const DOC = join(ROOT, 'docs/design-system.md');
const START = '<!-- GENERATED:colors START -->';
const END = '<!-- GENERATED:colors END -->';

const CARD = { light: '#ffffff', dark: '#1a201d' };

const fmtHsl = (hex) => {
  const { h, s, l } = hexToHsl(hex);
  return `${Math.round(h)} ${Math.round(s)}% ${Math.round(l)}%`;
};
const fmtRgb = (hex) => {
  const { r, g, b } = hexToRgb(hex);
  return `${r} ${g} ${b}`;
};

const modules = readModuleTints();
const semantic = readSemanticColors();

const lines = [];
const push = (s = '') => lines.push(s);

push(START);
push();
push('<!--');
push('  Do not edit by hand — run `npm run docs:design`.');
push('  Generated from constants/design-tokens.ts by scripts/gen-design-doc.mjs.');
push('-->');
push();

// --- core ---
push('### Core');
push();
push('| Token | light | RGB | HSL | dark | RGB | HSL |');
push('| ----- | ----- | --- | --- | ---- | --- | --- |');
for (const key of [
  'background',
  'surface',
  'card',
  'foreground',
  'mutedForeground',
  'accent',
  'border',
]) {
  const l = semantic.light[key];
  const d = semantic.dark[key];
  if (!l || !d) continue;
  push(
    `| \`${key}\` | \`${l.toUpperCase()}\` | ${fmtRgb(l)} | ${fmtHsl(l)} ` +
      `| \`${d.toUpperCase()}\` | ${fmtRgb(d)} | ${fmtHsl(d)} |`,
  );
}
push();

// --- semantic ---
push('### Semantic — state, never brand');
push();
push('| Token | light | dark | Purpose |');
push('| ----- | ----- | ---- | ------- |');
const PURPOSE = {
  success: 'Completion, confirmation',
  warning: 'Caution, attention soon',
  error: 'Destructive actions, validation',
  info: 'Neutral info, tips',
};
for (const [key, purpose] of Object.entries(PURPOSE)) {
  push(
    `| \`${key}\` | \`${semantic.light[key].toUpperCase()}\` ` +
      `| \`${semantic.dark[key].toUpperCase()}\` | ${purpose} |`,
  );
}
push();

// --- modules ---
push('### Module signature tints');
push();
push(
  "Contrast is measured against that theme's card — the bar is **3:1**, because " +
    'these are drawn as fills: rings, dots, chart series and icons. For a tint used ' +
    'as *text* use `moduleTintText()`, which targets 4.5:1.',
);
push();
push('| Module | light | on light card | dark | on dark card | Hue |');
push('| ------ | ----- | ------------- | ---- | ------------ | --- |');
for (const [name, pair] of Object.entries(modules)) {
  const cl = contrastRatio(pair.light, CARD.light);
  const cd = contrastRatio(pair.dark, CARD.dark);
  const mark = (r) => (r >= 3 ? '' : ' ⚠️');
  push(
    `| ${name} | \`${pair.light.toUpperCase()}\` | ${cl.toFixed(2)}:1${mark(cl)} ` +
      `| \`${pair.dark.toUpperCase()}\` | ${cd.toFixed(2)}:1${mark(cd)} ` +
      `| ${Math.round(hexToHsl(pair.light).h)}° |`,
  );
}
push();

// --- hue crowding ---
// Honest about a structural limit rather than restating a rule the palette
// cannot keep: 360° / 30° caps you at twelve, and there are more than twelve.
const entries = Object.entries(modules).filter(([n]) => n !== 'settings');
const clashes = [];
for (let i = 0; i < entries.length; i++) {
  for (let j = i + 1; j < entries.length; j++) {
    let d = Math.abs(hexToHsl(entries[i][1].light).h - hexToHsl(entries[j][1].light).h);
    if (d > 180) d = 360 - d;
    if (d < 30) clashes.push([entries[i][0], entries[j][0], d]);
  }
}
push('### Hue crowding');
push();
push(
  `The system aims to keep module hues ~30° apart. With **${entries.length}** tints that is ` +
    'arithmetically impossible — 360° / 30° allows twelve — so the following pairs sit ' +
    'closer, and those modules must be told apart by icon, shape and the data they ' +
    'carry rather than by colour alone.',
);
push();
if (clashes.length === 0) {
  push('_None._');
} else {
  push('| Pair | Apart |');
  push('| ---- | ----- |');
  for (const [a, b, d] of clashes.sort((x, y) => x[2] - y[2])) {
    push(`| ${a} ↔ ${b} | ${d.toFixed(0)}° |`);
  }
}
push();
push(END);

const doc = readFileSync(DOC, 'utf8');
const start = doc.indexOf(START);
const end = doc.indexOf(END);
if (start === -1 || end === -1) {
  console.error(`docs/design-system.md is missing the ${START} / ${END} markers.`);
  process.exit(1);
}

const next = doc.slice(0, start) + lines.join('\n') + doc.slice(end + END.length);
const changed = next !== doc;
writeFileSync(DOC, next);

console.log(
  changed
    ? `Regenerated the colour tables (${Object.keys(modules).length} modules, ${clashes.length} crowded pairs).`
    : 'Colour tables already up to date.',
);
