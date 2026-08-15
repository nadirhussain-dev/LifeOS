#!/usr/bin/env node
/**
 * Synthesises LifeOS's notification tones into `assets/sounds/`.
 *
 * ## Why the sounds are generated rather than sourced
 *
 * A notification tone is played on other people's phones, at unpredictable
 * moments, forever. Every stock or marketplace tone carries a licence that has
 * to keep being true for as long as the app is installed, and "we found it in a
 * pack" is not an answer anyone wants to give later. These are additive
 * synthesis — sine partials and exponential decays, written here — so the
 * provenance is this file and the licence is the repository's.
 *
 * It is also the only way a library this size can be *coherent*. Every tone is
 * built from the same handful of voice models and normalised to one loudness
 * target, so moving between them changes the character of the alert and never
 * how loud the phone gets. A pack of thirty tones assembled from thirty sources
 * cannot make that promise, and the result is a picker where half the options
 * are unusable because they are twice as loud as the rest.
 *
 * ## The voice model
 *
 * A struck resonant body: several partials at fixed frequency ratios, each with
 * its own amplitude and its own decay rate. Higher partials decay faster than
 * lower ones — that is the whole difference between a bell and a beep, and it
 * is why `decay` shrinks down each list below. A short raised-cosine attack
 * replaces the instantaneous onset, which would otherwise be an audible click
 * rather than a strike.
 *
 * Two extras earn their keep across a library this wide:
 *
 *  - **`glideTo`** sweeps the pitch over the note, which is the entire
 *    difference between a blip and a water drop. It is why the oscillators
 *    accumulate phase per sample rather than evaluating `sin(2πft)` — with a
 *    moving `f` the closed form is simply wrong, and produces a discontinuity
 *    you can hear as a buzz.
 *  - **`attackSeconds`** per voice, so a singing bowl can swell over 150 ms
 *    while a blip still starts in six.
 *
 * ## Constraints these files have to satisfy
 *
 *  - **Filenames are `[a-z0-9_]` only.** The expo-notifications config plugin
 *    copies them into `android/app/src/main/res/raw/`, and Android resource
 *    names reject hyphens and capitals — a dash here fails the native build,
 *    not the JS bundle, so it would surface as a mystery at EAS build time.
 *  - **16-bit PCM mono at 44.1 kHz.** The intersection of what Android's
 *    `res/raw` and iOS's `UNNotificationSound` both accept without conversion.
 *  - **Short.** iOS truncates a notification sound at 30 s, but the real limit
 *    is social: this plays in a meeting. Everything here is under two seconds,
 *    and the library's total weight is asserted by the test beside the registry.
 *
 * Run with `node scripts/generate-notification-sounds.mjs`. Deterministic —
 * re-running produces byte-identical files, so it is safe in CI and produces no
 * diff noise.
 */

// Imported rather than taken from the global, matching scripts/make-grain.mjs —
// the lint config treats these as modules, where the Node globals are not
// assumed to exist.
import { Buffer } from 'node:buffer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SAMPLE_RATE = 44_100;
/** Peak amplitude after normalisation. Short of 1.0 so that the 16-bit
 *  conversion never lands on a clipped sample, which reads as a tick. */
const PEAK = 0.89;
const DEFAULT_ATTACK_SECONDS = 0.006;
/** Silence is expensive at the end of a notification — it delays nothing but
 *  the fade, and this is the ramp that keeps the tail from cutting off. */
const RELEASE_SECONDS = 0.02;

/** Equal temperament, A4 = 440 Hz. Named notes read better than magic floats
 *  in the tone tables below. */
function note(name) {
  const SEMITONES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const match = /^([A-G])(#?)(\d)$/.exec(name);
  if (!match) throw new Error(`Unparseable note: ${name}`);
  const [, letter, sharp, octave] = match;
  const midi = (Number(octave) + 1) * 12 + SEMITONES[letter] + (sharp ? 1 : 0);
  return 440 * 2 ** ((midi - 69) / 12);
}

/**
 * One struck note, mixed into `buffer` starting at `startSeconds`.
 *
 * `partials` is a list of `[ratio, amplitude, decaySeconds]`. The ratios are
 * what decide the instrument: exact integers are a pure harmonic series (organ,
 * voice), while the slightly stretched ratios of the bell below are what make
 * it sound struck rather than blown.
 */
function strike(buffer, voice) {
  const {
    startSeconds,
    frequency,
    gain,
    partials,
    durationSeconds,
    attackSeconds = DEFAULT_ATTACK_SECONDS,
    glideTo = null,
  } = voice;

  const start = Math.round(startSeconds * SAMPLE_RATE);
  const length = Math.round(durationSeconds * SAMPLE_RATE);
  // One running phase per partial. See the header: with a gliding frequency the
  // closed-form sine is not merely imprecise, it is discontinuous.
  const phases = partials.map(() => 0);
  const glideRatio = glideTo === null ? 1 : glideTo / frequency;

  for (let i = 0; i < length; i++) {
    const index = start + i;
    if (index >= buffer.length) break;
    const t = i / SAMPLE_RATE;

    // Exponential rather than linear, because pitch is heard logarithmically —
    // a linear sweep sounds like it slows down as it falls.
    const current = frequency * glideRatio ** (t / durationSeconds);

    // Raised-cosine attack: starts and ends with zero slope, so there is no
    // discontinuity for the speaker to click on.
    const attack = t < attackSeconds ? 0.5 - 0.5 * Math.cos((Math.PI * t) / attackSeconds) : 1;

    let sample = 0;
    for (let p = 0; p < partials.length; p++) {
      const [ratio, amplitude, decaySeconds] = partials[p];
      phases[p] += (2 * Math.PI * current * ratio) / SAMPLE_RATE;
      sample += amplitude * Math.exp(-t / decaySeconds) * Math.sin(phases[p]);
    }

    buffer[index] += sample * attack * gain;
  }
}

/** Normalises to PEAK and fades the last few milliseconds to true zero. */
function finish(buffer) {
  let max = 0;
  for (const sample of buffer) max = Math.max(max, Math.abs(sample));
  const scale = max > 0 ? PEAK / max : 0;

  const releaseSamples = Math.round(RELEASE_SECONDS * SAMPLE_RATE);
  for (let i = 0; i < buffer.length; i++) {
    const fromEnd = buffer.length - 1 - i;
    const release = fromEnd < releaseSamples ? fromEnd / releaseSamples : 1;
    buffer[i] *= scale * release;
  }
  return buffer;
}

/** 16-bit PCM mono WAV. Written by hand because the alternative is a
 *  dependency for 44 bytes of header. */
function toWav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    data.writeInt16LE(Math.round(clamped * 32_767), i * 2);
  }

  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); // format: PCM
  header.writeUInt16LE(1, 22); // channels: mono
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);

  return Buffer.concat([header, data]);
}

// ---------------------------------------------------------------------------
// Voice models. `[ratio, amplitude, decaySeconds]` per partial.
// ---------------------------------------------------------------------------

/** Struck metal: stretched, inharmonic ratios and a long fundamental. */
const BELL = [
  [1, 1.0, 1.05],
  [2.0, 0.5, 0.72],
  [2.99, 0.34, 0.52],
  [4.24, 0.2, 0.36],
  [5.43, 0.11, 0.24],
];

/** A smaller, brighter bell — less fundamental, more upper partial. */
const BELL_SMALL = [
  [1, 0.7, 0.5],
  [2.76, 1.0, 0.42],
  [5.4, 0.4, 0.24],
  [8.93, 0.15, 0.12],
];

/** Struck wood: the tuned-bar series, which dies almost immediately. */
const WOOD = [
  [1, 1.0, 0.42],
  [3.93, 0.26, 0.15],
  [9.6, 0.09, 0.07],
];

/** A larger, hollower bar — bamboo rather than rosewood. */
const WOOD_HOLLOW = [
  [1, 1.0, 0.34],
  [3.0, 0.3, 0.12],
  [5.0, 0.1, 0.06],
];

/** Blown glass: a plain harmonic series, no inharmonicity at all. */
const GLASS = [
  [1, 1.0, 0.95],
  [2, 0.3, 0.6],
  [3, 0.12, 0.4],
];

/** Rubbed crystal — very high, very thin, almost no fundamental. */
const CRYSTAL = [
  [1, 0.35, 0.8],
  [2.4, 1.0, 0.7],
  [4.1, 0.3, 0.35],
];

/**
 * A singing bowl. The two near-unison partials are the point: at three cents
 * apart they beat against each other roughly once a second, which is the slow
 * shimmer that makes a bowl sound alive rather than synthetic.
 */
const BOWL = [
  [1, 1.0, 1.6],
  [1.003, 0.9, 1.6],
  [2.7, 0.28, 0.9],
  [5.2, 0.08, 0.4],
];

/** An electric-piano tine: a harmonic body under a bright, instant click. */
const TINE = [
  [1, 1.0, 0.7],
  [2, 0.35, 0.45],
  [4, 0.12, 0.2],
  [14, 0.14, 0.025],
];

/** A plucked string — a full harmonic series that thins as it decays. */
const PLUCK = [
  [1, 1.0, 0.62],
  [2, 0.5, 0.4],
  [3, 0.3, 0.26],
  [4, 0.18, 0.17],
  [5, 0.1, 0.11],
  [6, 0.06, 0.08],
];

/** Felt-damped: the fundamental with the top taken off. */
const FELT = [
  [1, 1.0, 0.5],
  [2, 0.16, 0.22],
];

/** Odd harmonics only — the hollow, reedy character of a stopped pipe. */
const HOLLOW = [
  [1, 1.0, 0.5],
  [3, 0.33, 0.3],
  [5, 0.2, 0.18],
  [7, 0.1, 0.1],
];

/** Dry electronic blip — one partial and a whisper of the octave. */
const BLIP = [
  [1, 1.0, 0.085],
  [2, 0.22, 0.05],
];

/** The same, with a longer body — a console beep rather than a tick. */
const BEEP = [
  [1, 1.0, 0.19],
  [2, 0.3, 0.1],
  [3, 0.1, 0.05],
];

/** Nearly a pure sine: what a pitch glide needs so the sweep is the only thing
 *  you hear. */
const SINE = [
  [1, 1.0, 0.5],
  [2, 0.06, 0.2],
];

// ---------------------------------------------------------------------------
// The library.
//
// Grouped by family, matching the sections the picker renders. Within a family
// the tones differ by register, interval and length rather than by voice, so
// each family reads as a set rather than as five unrelated sounds.
// ---------------------------------------------------------------------------

/** One strike, spelled out. Keeps the table below to one line per note. */
const hit = (at, pitch, gain, partials, seconds, extra = {}) => ({
  startSeconds: at,
  frequency: typeof pitch === 'string' ? note(pitch) : pitch,
  gain,
  partials,
  durationSeconds: seconds,
  ...extra,
});

const SOUNDS = {
  // --- Bells: struck metal, the register most "notification" tones live in ---
  lifeos_chime: [1.45, [hit(0, 'E6', 1.0, BELL, 1.45), hit(0.15, 'G6', 0.85, BELL, 1.3)]],
  lifeos_beacon: [
    1.9,
    [
      hit(0, 'G4', 1.0, BELL, 1.9),
      hit(0.005, 'G5', 0.4, BELL, 1.7),
      hit(0.3, 'D6', 0.22, BELL, 1.5),
    ],
  ],
  lifeos_halo: [1.6, [hit(0, 'B5', 1.0, BELL, 1.6), hit(0.02, 'F#6', 0.6, BELL, 1.5)]],
  lifeos_vesper: [1.8, [hit(0, 'C5', 1.0, BELL, 1.8)]],
  lifeos_carillon: [
    1.7,
    [
      hit(0, 'E6', 1.0, BELL, 1.7),
      hit(0.13, 'D6', 0.9, BELL, 1.55),
      hit(0.26, 'B5', 0.8, BELL, 1.42),
      hit(0.39, 'G5', 0.75, BELL, 1.3),
    ],
  ],
  lifeos_ember: [1.35, [hit(0, 'A5', 1.0, BELL, 1.35), hit(0.19, 'E6', 0.5, BELL, 1.1)]],
  lifeos_filament: [
    1.2,
    [hit(0, 'D6', 1.0, BELL_SMALL, 1.2), hit(0.1, 'A6', 0.55, BELL_SMALL, 1.05)],
  ],

  // --- Mallets: tuned bars. Fast, dry, the least intrusive family ---
  lifeos_ripple: [
    0.95,
    [
      hit(0, 'A5', 1.0, WOOD, 0.95),
      hit(0.085, 'C#6', 0.9, WOOD, 0.86),
      hit(0.17, 'E6', 0.8, WOOD, 0.78),
    ],
  ],
  lifeos_tumble: [
    0.9,
    [
      hit(0, 'D6', 1.0, WOOD, 0.9),
      hit(0.09, 'B5', 0.9, WOOD, 0.81),
      hit(0.18, 'G5', 0.85, WOOD, 0.72),
    ],
  ],
  lifeos_pebble: [0.5, [hit(0, 'C6', 1.0, WOOD, 0.5)]],
  lifeos_lattice: [
    0.95,
    [
      hit(0, 'G5', 1.0, WOOD, 0.6),
      hit(0.07, 'D6', 0.85, WOOD, 0.6),
      hit(0.14, 'A5', 0.8, WOOD, 0.6),
      hit(0.21, 'E6', 0.75, WOOD, 0.74),
    ],
  ],
  lifeos_bamboo: [
    0.85,
    [hit(0, 'G4', 1.0, WOOD_HOLLOW, 0.85), hit(0.11, 'D5', 0.7, WOOD_HOLLOW, 0.7)],
  ],
  lifeos_thimble: [0.45, [hit(0, 'E6', 1.0, WOOD, 0.28), hit(0.1, 'E6', 0.7, WOOD, 0.35)]],

  // --- Glass & air: slow, pure, the softest family ---
  lifeos_bloom: [
    1.7,
    [
      hit(0, 'D6', 1.0, GLASS, 1.7),
      hit(0.02, 'A6', 0.55, GLASS, 1.6),
      hit(0.24, 'D7', 0.3, GLASS, 1.4),
    ],
  ],
  lifeos_prism: [1.3, [hit(0, 'B6', 1.0, CRYSTAL, 1.3)]],
  lifeos_frost: [1.15, [hit(0, 'C7', 1.0, CRYSTAL, 1.15), hit(0.08, 'G6', 0.5, CRYSTAL, 1.0)]],
  lifeos_lantern: [1.5, [hit(0, 'E5', 1.0, GLASS, 1.5, { attackSeconds: 0.05 })]],
  lifeos_aurora: [
    1.95,
    [
      hit(0, 'F4', 1.0, BOWL, 1.95, { attackSeconds: 0.12 }),
      hit(0.1, 'C5', 0.35, BOWL, 1.7, { attackSeconds: 0.15 }),
    ],
  ],
  lifeos_nimbus: [
    1.85,
    [
      hit(0, 'A4', 1.0, GLASS, 1.85, { attackSeconds: 0.16 }),
      hit(0.05, 'E5', 0.5, GLASS, 1.7, { attackSeconds: 0.18 }),
    ],
  ],

  // --- Keys & strings: plucked and struck, warmer and more human ---
  lifeos_amber: [1.15, [hit(0, 'C5', 1.0, TINE, 1.15), hit(0.14, 'G5', 0.55, TINE, 1.0)]],
  lifeos_thread: [
    1.2,
    [
      hit(0, 'G5', 1.0, PLUCK, 1.2),
      hit(0.08, 'B5', 0.85, PLUCK, 1.1),
      hit(0.16, 'D6', 0.8, PLUCK, 1.0),
    ],
  ],
  lifeos_quill: [1.0, [hit(0, 'D5', 1.0, PLUCK, 1.0, { glideTo: note('D5') * 1.06 })]],
  lifeos_wool: [0.95, [hit(0, 'F5', 1.0, FELT, 0.95, { attackSeconds: 0.02 })]],
  lifeos_reed: [1.05, [hit(0, 'A4', 1.0, HOLLOW, 1.05, { attackSeconds: 0.03 })]],
  lifeos_lyre: [
    1.25,
    [
      hit(0, 'E5', 1.0, PLUCK, 1.25),
      hit(0.06, 'A5', 0.9, PLUCK, 1.15),
      hit(0.12, 'C#6', 0.85, PLUCK, 1.08),
      hit(0.18, 'E6', 0.8, PLUCK, 1.0),
    ],
  ],

  // --- Digital: dry, deliberate, no pretence of being an instrument ---
  lifeos_pulse: [0.42, [hit(0, 'C6', 1.0, BLIP, 0.2), hit(0.13, 'C6', 0.95, BLIP, 0.29)]],
  lifeos_ping: [0.3, [hit(0, 'A6', 1.0, BLIP, 0.3)]],
  lifeos_relay: [
    0.55,
    [
      hit(0, 'E5', 1.0, BEEP, 0.2),
      hit(0.11, 'A5', 0.95, BEEP, 0.2),
      hit(0.22, 'E6', 0.9, BEEP, 0.33),
    ],
  ],
  lifeos_console: [0.62, [hit(0, 'F5', 1.0, BEEP, 0.26), hit(0.16, 'C6', 0.95, BEEP, 0.46)]],
  lifeos_ledger: [0.5, [hit(0, 'G4', 1.0, BEEP, 0.22), hit(0.12, 'G4', 0.9, BEEP, 0.38)]],
  lifeos_telegraph: [
    0.72,
    [
      hit(0, 'C6', 1.0, BLIP, 0.12),
      hit(0.1, 'C6', 1.0, BLIP, 0.12),
      hit(0.2, 'G5', 0.95, BEEP, 0.52),
    ],
  ],

  // --- Motion: pitch that moves. The only family that sweeps ---
  lifeos_droplet: [0.8, [hit(0, 'A6', 1.0, SINE, 0.8, { glideTo: note('A5') })]],
  lifeos_skyward: [0.7, [hit(0, 'C5', 1.0, SINE, 0.7, { glideTo: note('C6') })]],
  lifeos_swoop: [
    0.95,
    [
      hit(0, 'E6', 1.0, SINE, 0.42, { glideTo: note('E5') }),
      hit(0.4, 'E5', 0.9, SINE, 0.55, { glideTo: note('B5') }),
    ],
  ],
  lifeos_bubble: [
    0.85,
    [
      hit(0, 'D5', 1.0, SINE, 0.3, { glideTo: note('A5') }),
      hit(0.16, 'F#5', 0.9, SINE, 0.3, { glideTo: note('C#6') }),
      hit(0.32, 'A5', 0.85, SINE, 0.5, { glideTo: note('E6') }),
    ],
  ],
  lifeos_kite: [1.0, [hit(0, 'G5', 1.0, SINE, 1.0, { glideTo: note('D6'), attackSeconds: 0.04 })]],

  // --- Alerts: for people who need the phone to insist ---
  lifeos_sentry: [
    0.95,
    [
      hit(0, 'B5', 1.0, BEEP, 0.16),
      hit(0.13, 'B5', 1.0, BEEP, 0.16),
      hit(0.26, 'B5', 1.0, BEEP, 0.16),
      hit(0.45, 'F#6', 0.95, BEEP, 0.5),
    ],
  ],
  lifeos_cascade: [
    1.3,
    [
      hit(0, 'E6', 1.0, BELL_SMALL, 0.5),
      hit(0.09, 'C#6', 0.95, BELL_SMALL, 0.5),
      hit(0.18, 'A5', 0.9, BELL_SMALL, 0.6),
      hit(0.27, 'F#5', 0.85, BELL_SMALL, 0.7),
      hit(0.36, 'D5', 0.85, BELL_SMALL, 0.94),
    ],
  ],
  lifeos_summit: [
    1.45,
    [
      hit(0, 'D5', 1.0, BELL, 1.45),
      hit(0.18, 'A5', 0.95, BELL, 1.25),
      hit(0.36, 'D6', 0.9, BELL, 1.05),
    ],
  ],
};

/**
 * Refuses to write a tone containing a partial above the Nyquist limit.
 *
 * Not hypothetical: `filament` puts BELL_SMALL's 8.93× partial on an A6, which
 * lands at 15.7 kHz — comfortably under 44.1 kHz's 22.05 kHz ceiling and *above*
 * 32 kHz's. Dropping the sample rate to save space would therefore have folded
 * that partial back down the spectrum as an inharmonic whistle, on one tone out
 * of thirty-nine, with nothing in the build to say so. A pitch or a voice model
 * edited later could do the same thing just as quietly.
 *
 * The margin is deliberate. A decaying partial is not a pure line — it has
 * skirts — so "just under Nyquist" still folds audible energy back.
 */
function assertBelowNyquist(name, voices) {
  const ceiling = SAMPLE_RATE / 2;
  for (const voice of voices) {
    const top = Math.max(voice.frequency, voice.glideTo ?? voice.frequency);
    for (const [ratio] of voice.partials) {
      const hz = top * ratio;
      if (hz > ceiling * 0.9) {
        throw new Error(
          `${name}: partial at ${Math.round(hz)} Hz is too close to the ${ceiling} Hz Nyquist ` +
            `limit and will alias. Lower the pitch, drop the top partial, or raise SAMPLE_RATE.`,
        );
      }
    }
  }
}

const outputDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'sounds');
mkdirSync(outputDir, { recursive: true });

let totalBytes = 0;
for (const [name, [durationSeconds, voices]] of Object.entries(SOUNDS)) {
  assertBelowNyquist(name, voices);
  const buffer = new Float64Array(Math.round(durationSeconds * SAMPLE_RATE));
  for (const voice of voices) strike(buffer, voice);
  const wav = toWav(finish(buffer));
  writeFileSync(join(outputDir, `${name}.wav`), wav);
  totalBytes += wav.length;
}

console.log(
  `${Object.keys(SOUNDS).length} tones, ${(totalBytes / 1024 / 1024).toFixed(2)} MB total → assets/sounds/`,
);
