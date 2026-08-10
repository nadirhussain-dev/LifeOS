#!/usr/bin/env node
/**
 * Generates assets/grain.png — a small tileable monochrome noise square.
 *
 * `npm run assets:grain`
 *
 * Why a generated PNG rather than a shader: the effect needs one texture the
 * whole app tiles at low opacity, and that is the one thing a PNG does with no
 * dependencies. The alternatives were @shopify/react-native-skia, a native
 * module needing an EAS rebuild before anyone can see it render, or
 * react-native-svg's `feTurbulence`, whose JS side is `render(): null` and
 * whose native support is not something to bet a whole-app visual on. This
 * runs in Node, produces a reviewable file, and works on the existing build.
 *
 * The encoder is the same zlib + CRC32 one in make-brand-assets.mjs; PNG is
 * not much more than that.
 *
 * Deterministic on purpose. A fixed seed means the file only changes when the
 * parameters do, so `git diff` on a binary asset stays meaningful and CI never
 * sees a spurious change.
 */
import { Buffer } from 'node:buffer';
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { ROOT } from './tokens.mjs';

/** 128 tiles without a visible repeat at phone scale and costs ~8KB. */
const SIZE = 128;

/**
 * Grain is monochrome and lives in the alpha channel: white pixels at varying
 * opacity. Painted over the app with a low overall opacity it lifts light
 * grounds and, more importantly, breaks up the banding that large dark
 * gradients show on OLED — which is where flat digital UI looks most obviously
 * flat.
 */
const MIN_ALPHA = 0;
const MAX_ALPHA = 255;

/** Mulberry32 — small, fast, and seeded, so the output is reproducible. */
function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = rng(0x1f05105);
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));

for (let y = 0; y < SIZE; y++) {
  const rowStart = y * (SIZE * 4 + 1);
  raw[rowStart] = 0; // PNG filter: None
  for (let x = 0; x < SIZE; x++) {
    const i = rowStart + 1 + x * 4;
    // Average two samples: pure uniform noise reads as harsh static, and this
    // pulls the distribution toward the middle so it reads as film grain.
    const n = (random() + random()) / 2;
    raw[i] = 255; // R
    raw[i + 1] = 255; // G
    raw[i + 2] = 255; // B
    raw[i + 3] = Math.round(MIN_ALPHA + n * (MAX_ALPHA - MIN_ALPHA));
  }
}

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

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // truecolour + alpha

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = join(ROOT, 'assets/grain.png');
writeFileSync(out, png);
console.log(`Wrote assets/grain.png — ${SIZE}×${SIZE}, ${(png.length / 1024).toFixed(1)}KB`);
