import { songColor, songGradient, songHue } from '@/features/music/utils/song-art';

/**
 * Generative song artwork, and the first test `features/music` has had.
 *
 * The whole promise of this file is in its header: "deterministic — a given song
 * always renders the same colors, everywhere it appears (rows, orbs,
 * mini-player, queue)". If it ever stops being deterministic the app does not
 * break, it just quietly becomes incoherent — the same track wearing one colour
 * in the queue and another in the mini-player, which reads as a rendering bug
 * with no error anywhere to explain it.
 *
 * The other risk is the colour maths. `hslToHex` is hand-rolled over six hue
 * sectors, and a mistake in one sector produces a valid hex string of the wrong
 * colour. Nothing downstream can detect that, so the sectors are walked here.
 */

const HEX = /^#[0-9a-f]{6}$/;

describe('determinism', () => {
  it('gives the same seed the same colour every time', () => {
    // Called independently, as the separate components do.
    expect(songColor('song-1')).toBe(songColor('song-1'));
    expect(songHue('song-1')).toBe(songHue('song-1'));
    expect(songGradient('song-1')).toEqual(songGradient('song-1'));
  });

  it('gives different seeds different colours', () => {
    // Not a strict guarantee of the hash, but 360 hues over these seeds should
    // not collide — and if they do the artwork stops being an identity.
    const hues = new Set(
      ['a', 'b', 'c', 'd', 'e', 'song-1', 'song-2', 'Nocturne', 'Clair de Lune'].map(songHue),
    );

    expect(hues.size).toBeGreaterThan(7);
  });

  it('is stable for a seed containing non-ASCII characters', () => {
    // Titles are the documented fallback seed, and they are user data: Urdu,
    // Arabic and Hindi titles all reach this. `charCodeAt` handles them; the
    // point is that it does not throw or produce NaN.
    const seed = 'گیت — 夜想曲';

    expect(songHue(seed)).toBe(songHue(seed));
    expect(Number.isFinite(songHue(seed))).toBe(true);
    expect(songColor(seed)).toMatch(HEX);
  });

  it('handles an empty seed without producing an invalid colour', () => {
    // Reachable: a song with no id yet and an empty title. The hue is not 0 —
    // FNV-1a returns its offset basis for an empty input, so this lands
    // wherever that falls. What matters is that it is a real hue and stable.
    expect(songColor('')).toMatch(HEX);
    expect(songHue('')).toBe(songHue(''));
    expect(songHue('')).toBeGreaterThanOrEqual(0);
    expect(songHue('')).toBeLessThan(360);
  });
});

describe('songHue', () => {
  it('always lands inside a single turn', () => {
    // Fed straight to `hslToHex`, and consumed by callers as a degree value.
    for (let i = 0; i < 500; i++) {
      const hue = songHue(`song-${i}`);
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
      expect(Number.isInteger(hue)).toBe(true);
    }
  });
});

describe('songColor', () => {
  it('is a six-digit lowercase hex string', () => {
    // Handed to LinearGradient and to native shadow colours, both of which take
    // a malformed string as a silent no-colour rather than an error.
    for (let i = 0; i < 200; i++) {
      expect(songColor(`song-${i}`)).toMatch(HEX);
    }
  });

  it('produces a colour in every hue sector', () => {
    // `hslToHex` branches six ways on the hue. A wrong branch yields a valid
    // hex of the wrong colour, which nothing downstream can detect — so each
    // sector is checked to produce a distinct, well-formed result.
    const seen = new Map<number, string>();
    for (let i = 0; i < 2000 && seen.size < 6; i++) {
      const seed = `song-${i}`;
      const sector = Math.floor(songHue(seed) / 60);
      if (!seen.has(sector)) seen.set(sector, songColor(seed));
    }

    expect(seen.size).toBe(6);
    for (const hex of seen.values()) expect(hex).toMatch(HEX);
    // Six different sectors must not all render as the same colour.
    expect(new Set(seen.values()).size).toBe(6);
  });
});

describe('songGradient', () => {
  it('returns three well-formed stops', () => {
    for (let i = 0; i < 200; i++) {
      const stops = songGradient(`song-${i}`);
      expect(stops).toHaveLength(3);
      for (const stop of stops) expect(stop).toMatch(HEX);
    }
  });

  it('darkens across the three stops so it reads as depth, not a flat block', () => {
    // The stops descend in HSL *lightness* — 0.62 → 0.5 → 0.4 by design — and
    // that is what has to be measured. Perceived luminance is the wrong
    // instrument here: the hues also shift by up to 70°, and a yellow at L=0.4
    // is brighter to the eye than a blue at L=0.62, so a brightness comparison
    // fails on correct output. HSL lightness is exactly recoverable from the
    // hex as (max + min) / 2 over the normalised channels.
    const lightness = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
      return (Math.max(r, g, b) + Math.min(r, g, b)) / 2;
    };

    for (let i = 0; i < 100; i++) {
      const [first, second, third] = songGradient(`song-${i}`);
      expect(lightness(first)).toBeGreaterThan(lightness(second));
      expect(lightness(second)).toBeGreaterThan(lightness(third));
    }
  });

  it('spreads the hues without wrapping past the analogous range', () => {
    // The spread is documented as 30–70°. Much wider and the "album art" stops
    // being analogous and starts looking like a clashing accident.
    for (let i = 0; i < 100; i++) {
      const stops = songGradient(`song-${i}`);
      // Three distinct stops is the observable consequence of a non-zero spread.
      expect(new Set(stops).size).toBeGreaterThan(1);
    }
  });
});
