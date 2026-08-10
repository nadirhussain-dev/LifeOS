/**
 * Reads the three token layers and reports what each one says.
 *
 * The layers are meant to mirror each other — global.css holds HSL, the
 * Tailwind config maps class names onto those variables, and design-tokens.ts
 * holds the hex the native side uses. Nothing checked that they agreed, and
 * they didn't: `gallery` and `music` existed only in the TS file, so
 * `text-gallery` compiled to nothing for months.
 *
 * Shared by scripts/check-tokens.mjs (the drift guard) and
 * scripts/gen-design-doc.mjs (the doc generator) so the guard and the docs
 * can never disagree about what the tokens are.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// --- colour maths -----------------------------------------------------------

export function hexToRgb(hex) {
  const n = hex.replace('#', '');
  const full =
    n.length === 3
      ? n
          .split('')
          .map((c) => c + c)
          .join('')
      : n;
  const i = parseInt(full, 16);
  return { r: (i >> 16) & 255, g: (i >> 8) & 255, b: i & 255 };
}

export function hexToHsl(hex) {
  const { r, g, b } = hexToRgb(hex);
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const d = max - min;
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d !== 0) {
    if (max === R) h = (((G - B) / d) % 6) * 60;
    else if (max === G) h = ((B - R) / d + 2) * 60;
    else h = ((R - G) / d + 4) * 60;
  }
  return { h: (h + 360) % 360, s: s * 100, l: l * 100 };
}

export function relativeLuminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  const c = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
}

export function contrastRatio(a, b) {
  const [A, B] = [relativeLuminance(a), relativeLuminance(b)];
  return (Math.max(A, B) + 0.05) / (Math.min(A, B) + 0.05);
}

// --- layer readers ----------------------------------------------------------

/** `{ light: { habit: {h,s,l} }, dark: {...} }` from the CSS custom properties. */
export function readCssVars() {
  const css = readFileSync(join(ROOT, 'global.css'), 'utf8');
  const block = (selector) => {
    const start = css.indexOf(selector);
    if (start === -1) throw new Error(`global.css: no ${selector} block`);
    return css.slice(start, css.indexOf('}', start));
  };
  const parse = (text) => {
    const out = {};
    for (const [, name, h, s, l] of text.matchAll(
      /--([a-z-]+):\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/g,
    )) {
      out[name] = { h: Number(h), s: Number(s), l: Number(l) };
    }
    return out;
  };
  return { light: parse(block(':root')), dark: parse(block('.dark:root')) };
}

/** The set of colour keys registered as Tailwind classes. */
export function readTailwindKeys() {
  const config = readFileSync(join(ROOT, 'tailwind.config.js'), 'utf8');
  const keys = new Set();
  for (const [, key] of config.matchAll(/^\s*([a-zA-Z]+):\s*'hsl\(var\(--/gm)) keys.add(key);
  for (const [, key] of config.matchAll(/^\s*([a-zA-Z]+):\s*\{\s*$/gm)) keys.add(key);
  return keys;
}

/**
 * `moduleTints` from design-tokens.ts, read as text rather than imported —
 * the file is TypeScript with path aliases, and a Node script should not need
 * a build step to answer "what colour is habit".
 */
export function readModuleTints() {
  const ts = readFileSync(join(ROOT, 'constants/design-tokens.ts'), 'utf8');
  const start = ts.indexOf('export const moduleTints = {');
  if (start === -1) throw new Error('design-tokens.ts: no moduleTints');
  const body = ts.slice(start, ts.indexOf('\n} as const;', start));
  const out = {};
  for (const [, name, light, dark] of body.matchAll(
    /^\s*([a-z]+):\s*\{\s*light:\s*'(#[0-9a-f]{6})',\s*dark:\s*'(#[0-9a-f]{6})'\s*\}/gim,
  )) {
    out[name] = { light, dark };
  }
  return out;
}

/** The semantic + core colours per theme from design-tokens.ts. */
export function readSemanticColors() {
  const ts = readFileSync(join(ROOT, 'constants/design-tokens.ts'), 'utf8');
  const start = ts.indexOf('export const colors = {');
  const body = ts.slice(start, ts.indexOf('\n} as const;', start));
  const themes = {};
  for (const theme of ['light', 'dark']) {
    const tStart = body.indexOf(`  ${theme}: {`);
    const tBody = body.slice(tStart, body.indexOf('\n  },', tStart));
    const out = {};
    for (const [, key, hex] of tBody.matchAll(/^\s*([a-zA-Z]+):\s*'(#[0-9a-f]{3,8})'/gm)) {
      out[key] = hex;
    }
    themes[theme] = out;
  }
  return themes;
}

/** HSL values are stored rounded in CSS, so compare with a tolerance. */
export function hslMatches(a, b, tolerance = { h: 2, s: 2, l: 2 }) {
  let dh = Math.abs(a.h - b.h);
  if (dh > 180) dh = 360 - dh;
  // Hue is meaningless at very low saturation, so don't judge it there.
  const hueOk = a.s < 8 || b.s < 8 || dh <= tolerance.h;
  return hueOk && Math.abs(a.s - b.s) <= tolerance.s && Math.abs(a.l - b.l) <= tolerance.l;
}
