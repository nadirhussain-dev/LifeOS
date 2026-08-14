#!/usr/bin/env node
/**
 * Generates every branded image the app ships with.
 *
 * The repo was still carrying the `create-expo-app` placeholders — grey
 * concentric circles on a graph-paper grid — as `icon.png`, `adaptive-icon.png`
 * and `splash-icon.png`. So an EAS build installed with a stock Expo icon on
 * the home screen and flashed the same placeholder on every cold start. The
 * config pointed at the right paths all along; the files behind them had simply
 * never been replaced.
 *
 * Drawn in code rather than committed as opaque binaries so the mark stays
 * reproducible and reviewable: `npm run assets`. PNG is only zlib + CRC32, so
 * the encoder is at the bottom of this file and there is no image dependency.
 *
 * ## The marks
 *
 * Twelve were drawn and compared at the size an icon is actually met at — a
 * settings row and a status bar, not a store page. `MARKS` keeps all of them and
 * `ACTIVE` picks the one that ships, so changing the app's identity is a
 * one-word edit and a re-run rather than a redraw.
 *
 * Shipping: **aperture** — six blades leaving a hexagonal opening. A shutter
 * mid-turn: the most kinetic of the set, and the only one whose negative space
 * does the work, which is what keeps it legible when it is 48px in a row of
 * settings. It reads as a lens on a life rather than a letter in a box.
 *
 * Three were drawn and discarded outright, because drawing them was the only
 * way to find out: a ligature that read as a "6", a sunrise that came out a
 * croissant, and a leaf that came out an umbrella. `strata` nearly joined them —
 * its nested squares rendered invisible until the hit test was reordered
 * smallest-first, since the outer square returns on every point inside it.
 *
 * Colours come from the same gradient the accent Button paints with, so the icon
 * and the app's primary action are visibly the same brand.
 */
import { Buffer } from 'node:buffer';
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');

/** Matches ACCENT_GRADIENT in components/ui/button.tsx. */
const GRADIENT_FROM = [0x22, 0xc5, 0x8e];
const GRADIENT_TO = [0x0b, 0x6b, 0x4f];
/** Emerald that clears 3:1 on the light splash ground (#f8fbf9). */
const MARK_ON_LIGHT = [0x0b, 0x6b, 0x4f];
/** Emerald tuned for the dark splash ground (#0e1210). */
const MARK_ON_DARK = [0x34, 0xd3, 0x99];
const WHITE = [0xff, 0xff, 0xff];

/** Supersampling. The mark is mostly curves and gets scaled down hard by every
 *  launcher, so aliasing shows immediately. */
const SS = 4;

// ---------------------------------------------------------------------------
// Geometry, in a normalized 0..1 mark box
// ---------------------------------------------------------------------------

/** Signed-distance-ish test for a rounded rectangle. */
function inRoundedRect(x, y, x0, y0, x1, y1, r) {
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function inCircle(x, y, cx, cy, r) {
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

const TAU = Math.PI * 2;

function inRing(x, y, cx, cy, r, width) {
  const d = Math.hypot(x - cx, y - cy);
  return d <= r + width / 2 && d >= r - width / 2;
}

/** Rotates the sample point by -a, which is the same as rotating the shape by
 *  +a — so blades can be authored once, upright, and placed by angle. */
function rotate(x, y, cx, cy, a) {
  const c = Math.cos(-a);
  const s = Math.sin(-a);
  const dx = x - cx;
  const dy = y - cy;
  return [cx + dx * c - dy * s, cy + dx * s + dy * c];
}

function inArc(x, y, cx, cy, r, width, from, to) {
  if (!inRing(x, y, cx, cy, r, width)) return false;
  let a = Math.atan2(y - cy, x - cx);
  if (a < 0) a += TAU;
  const s = from < 0 ? from + TAU : from;
  const e = to < 0 ? to + TAU : to;
  return s <= e ? a >= s && a <= e : a >= s || a <= e;
}

/**
 * Every mark, as coverage 0..1 over a normalized box.
 *
 * Not booleans: a value below 1 is a receded layer, which is what lets a shape
 * read as sitting *behind* rather than as another form competing for attention.
 */
export const MARKS = {
  /** Six blades leaving a hexagonal opening — a shutter mid-turn. */
  aperture(x, y) {
    for (let i = 0; i < 6; i++) {
      const [rx, ry] = rotate(x, y, 0.5, 0.5, (i * TAU) / 6);
      if (inRoundedRect(rx, ry, 0.46, 0.11, 0.81, 0.255, 0.055)) return 1;
    }
    return 0;
  },

  /** A cycle with something riding it. */
  orbit(x, y) {
    if (inArc(x, y, 0.5, 0.5, 0.3, 0.135, 0.35, TAU - 0.95)) return 1;
    if (inCircle(x, y, 0.5 + 0.3 * Math.cos(-0.3), 0.5 + 0.3 * Math.sin(-0.3), 0.115)) return 1;
    return 0;
  },

  /** Layers, turning — the spatial stack made literal. Smallest tested first,
   *  or the outer square returns on every point inside it and hides the rest. */
  strata(x, y) {
    for (const [size, angle, alpha] of [
      [0.26, 0.5, 1],
      [0.4, 0.25, 0.5],
      [0.54, 0, 0.28],
    ]) {
      const [rx, ry] = rotate(x, y, 0.5, 0.5, angle);
      const h = size / 2;
      if (inRoundedRect(rx, ry, 0.5 - h, 0.5 - h, 0.5 + h, 0.5 + h, size * 0.22)) return alpha;
    }
    return 0;
  },

  /** Where the parts of a life meet. */
  overlap(x, y) {
    let n = 0;
    for (let i = 0; i < 3; i++) {
      const a = (i * TAU) / 3 - Math.PI / 2;
      if (inCircle(x, y, 0.5 + Math.cos(a) * 0.15, 0.5 + Math.sin(a) * 0.15, 0.27)) n++;
    }
    return n === 0 ? 0 : Math.min(1, 0.34 + (n - 1) * 0.33);
  },

  /** A field with a rhythm running through it. */
  cadence(x, y) {
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        const r = 0.038 + 0.045 * (0.5 + 0.5 * Math.sin(i * 0.9 - j * 0.75 + 0.4));
        if (inCircle(x, y, 0.2 + i * 0.2, 0.2 + j * 0.2, r)) return 1;
      }
    }
    return 0;
  },

  /** One whole, two halves. */
  balance(x, y) {
    if (!inCircle(x, y, 0.5, 0.5, 0.36)) return 0;
    return x < 0.5 + 0.14 * Math.sin((y - 0.5) * Math.PI * 2.2) ? 1 : 0.42;
  },

  /** Areas opening from a hub kept as negative space. */
  bloom(x, y) {
    if (inCircle(x, y, 0.5, 0.5, 0.115)) return 0;
    for (const [cx, cy] of [
      [0.5, 0.25],
      [0.75, 0.5],
      [0.5, 0.75],
      [0.25, 0.5],
    ]) {
      if (inCircle(x, y, cx, cy, 0.225)) return 1;
    }
    return 0;
  },

  /** Cells of one structure. */
  comb(x, y) {
    const hex = (cx, cy, r) => {
      const dx = Math.abs(x - cx);
      const dy = Math.abs(y - cy);
      return dy <= r * 0.866 && dx * 0.866 + dy * 0.5 <= r * 0.866;
    };
    const R = 0.155;
    if (hex(0.5, 0.5, R)) return 1;
    for (let i = 0; i < 6; i++) {
      const a = (i * TAU) / 6 + Math.PI / 6;
      if (hex(0.5 + Math.cos(a) * R * 1.78, 0.5 + Math.sin(a) * R * 1.78, R)) return 0.42;
    }
    return 0;
  },

  /** An axis, a floor, and progress — the one mark carrying the initial. */
  ascent(x, y) {
    if (inRoundedRect(x, y, 0.14, 0.16, 0.28, 0.86, 0.07)) return 1;
    if (inRoundedRect(x, y, 0.14, 0.72, 0.88, 0.86, 0.07)) return 1;
    if (inRoundedRect(x, y, 0.37, 0.5, 0.51, 0.72, 0.07)) return 0.5;
    if (inRoundedRect(x, y, 0.6, 0.3, 0.74, 0.72, 0.07)) return 0.7;
    return 0;
  },

  /** Two loops, one thread. */
  continuum(x, y) {
    if (inRing(x, y, 0.33, 0.5, 0.19, 0.125)) return 1;
    if (inRing(x, y, 0.67, 0.5, 0.19, 0.125)) return 1;
    return 0;
  },

  /** The same path, further along. */
  spiral(x, y) {
    const r = Math.hypot(x - 0.5, y - 0.5);
    let a = Math.atan2(y - 0.5, x - 0.5);
    if (a < 0) a += TAU;
    for (let k = 0; k < 3; k++) {
      const target = 0.06 + 0.052 * (a + k * TAU);
      if (target > 0.44) break;
      if (Math.abs(r - target) <= 0.062) return 1;
    }
    return 0;
  },

  /** Four life areas as unlike shapes, two of them recessed. */
  modules(x, y) {
    if (inRoundedRect(x, y, 0.1, 0.1, 0.46, 0.46, 0.1)) return 1;
    if (inCircle(x, y, 0.72, 0.28, 0.18)) return 1;
    if (inCircle(x, y, 0.28, 0.72, 0.18)) return 0.45;
    if (inRoundedRect(x, y, 0.54, 0.54, 0.9, 0.9, 0.1)) return 0.45;
    return 0;
  },
};

/** The mark that ships. Change this and re-run; all seven files follow. */
const ACTIVE = 'aperture';

function markAlpha(x, y, layered = true) {
  const alpha = MARKS[ACTIVE](x, y);
  // Android renders the status-bar icon from the ALPHA channel alone, so a
  // recessed layer does not come out recessed — it fills. The stencil takes the
  // silhouette, or the mark becomes the solid white blob this file's
  // predecessor existed to avoid.
  if (!layered) return alpha > 0 ? 1 : 0;
  return alpha;
}

/** Where the mark has any ink at all — used for the bounding box. */
function isInk(x, y) {
  return MARKS[ACTIVE](x, y) > 0;
}

/**
 * Tight bounding box of the inked area.
 *
 * The mark's strokes do not fill their 0..1 box evenly — the L is bottom-left
 * heavy and the dot sits high right — so centring the BOX leaves the artwork
 * visibly off-centre in the icon. Measuring the ink and centring that instead
 * makes `scale` mean what a designer would expect: the fraction of the canvas
 * the visible mark occupies.
 */
const INK_BOX = (() => {
  const STEPS = 512;
  let minX = 1;
  let minY = 1;
  let maxX = 0;
  let maxY = 0;
  for (let i = 0; i < STEPS; i++) {
    for (let j = 0; j < STEPS; j++) {
      const x = (i + 0.5) / STEPS;
      const y = (j + 0.5) / STEPS;
      if (!isInk(x, y)) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
})();

// ---------------------------------------------------------------------------
// Rasterizing
// ---------------------------------------------------------------------------

/**
 * Renders the mark.
 *
 * `scale` is how much of the canvas the mark box occupies — full-bleed iOS
 * icons want generous padding, while an Android adaptive foreground has to stay
 * inside the ~66% the launcher mask can crop to.
 */
function render({ size, scale, markColor, background, stencil = false }) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  // Fit the ink's longest side to `scale` of the canvas, then centre the ink —
  // not the geometry box it happens to be defined in.
  const span = Math.max(INK_BOX.width, INK_BOX.height);
  const unit = (size * scale) / span;
  const offsetX = (size - INK_BOX.width * unit) / 2 - INK_BOX.minX * unit;
  const offsetY = (size - INK_BOX.height * unit) / 2 - INK_BOX.minY * unit;

  for (let py = 0; py < size; py++) {
    const rowStart = py * (size * 4 + 1);
    raw[rowStart] = 0; // PNG filter: None
    for (let px = 0; px < size; px++) {
      let accumulated = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const mx = (px + (sx + 0.5) / SS - offsetX) / unit;
          const my = (py + (sy + 0.5) / SS - offsetY) / unit;
          if (mx < 0 || mx > 1 || my < 0 || my > 1) continue;
          accumulated += markAlpha(mx, my, !stencil);
        }
      }
      const coverage = accumulated / (SS * SS);

      // Diagonal gradient, if this asset has a background at all.
      let base = [0, 0, 0];
      let baseAlpha = 0;
      if (background === 'gradient') {
        const t = (px / size + py / size) / 2;
        base = GRADIENT_FROM.map((from, i) => Math.round(from + (GRADIENT_TO[i] - from) * t));
        baseAlpha = 255;
      }

      // Composite the mark over the background.
      const alpha = baseAlpha + (255 - baseAlpha) * coverage;
      const mix = alpha === 0 ? 0 : (coverage * 255) / alpha;
      const o = rowStart + 1 + px * 4;
      raw[o] = Math.round(base[0] + (markColor[0] - base[0]) * mix);
      raw[o + 1] = Math.round(base[1] + (markColor[1] - base[1]) * mix);
      raw[o + 2] = Math.round(base[2] + (markColor[2] - base[2]) * mix);
      raw[o + 3] = Math.round(alpha);
    }
  }
  return encodePng(size, size, raw);
}

// ---------------------------------------------------------------------------
// Minimal PNG encoder — zlib + CRC32 is the whole format.
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

function encodePng(width, height, raw) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // truecolour + alpha
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

const OUTPUTS = [
  // iOS / store icon: full bleed, the OS applies its own corner mask.
  { file: 'icon.png', size: 1024, scale: 0.56, markColor: WHITE, background: 'gradient' },

  // Android adaptive foreground. Transparent, and deliberately small: the
  // launcher can crop to a circle inscribed in the middle ~66%, so anything
  // wider risks losing the dot on some OEM masks.
  { file: 'adaptive-icon.png', size: 1024, scale: 0.42, markColor: WHITE, background: 'none' },

  // The gradient behind that foreground, so Android gets the same treatment as
  // iOS rather than a flat fill.
  {
    file: 'adaptive-icon-background.png',
    size: 1024,
    scale: 0,
    markColor: WHITE,
    background: 'gradient',
  },

  // Splash marks. The native splash draws on the theme's own ground, so the
  // mark is tinted for contrast rather than being white on white.
  { file: 'splash-icon.png', size: 512, scale: 0.82, markColor: MARK_ON_LIGHT, background: 'none' },
  {
    file: 'splash-icon-dark.png',
    size: 512,
    scale: 0.82,
    markColor: MARK_ON_DARK,
    background: 'none',
  },

  // Web.
  { file: 'favicon.png', size: 64, scale: 0.6, markColor: WHITE, background: 'gradient' },

  // Android status bar. Android discards colour and uses the ALPHA channel as a
  // stencil, filling it with the channel accent — so this must be authored
  // white-on-transparent or it renders as a solid blob. Material asks for the
  // glyph to sit inside the middle 75% of the canvas.
  {
    file: 'notification-icon.png',
    size: 96,
    scale: 0.72,
    markColor: WHITE,
    background: 'none',
    stencil: true,
  },
];

for (const output of OUTPUTS) {
  // scale 0 = background only (the Android adaptive backdrop).
  const png = render(output.scale === 0 ? { ...output, scale: 1e-6 } : output);
  const path = join(ASSETS, output.file);
  writeFileSync(path, png);
  console.log(`wrote ${output.file} (${output.size}x${output.size}, ${png.length} bytes)`);
}
