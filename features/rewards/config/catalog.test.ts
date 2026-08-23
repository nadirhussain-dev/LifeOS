import { readFileSync } from 'fs';
import { join } from 'path';

import {
  BADGES,
  CHAINS,
  DEFAULT_CHAIN,
  FRAMES,
  THEMES,
  knownCosmeticSlugs,
  parseSlug,
} from './catalog';

/**
 * The seed and the catalog are one fact stored twice, and only this stands
 * between them.
 *
 * The failure it exists for is silent and slow: an operator's season grants
 * `theme:spark-dawn`, the ledger records it, the trophy case renders a blank
 * tile, and nobody finds out until somebody who spent seven days earning it
 * says so. Reading the SQL rather than restating it is the whole point — a
 * restatement drifts exactly as easily as the thing it was meant to guard.
 */
function seededCosmeticSlugs(): string[] {
  const sql = readFileSync(
    join(__dirname, '../../../supabase/migrations/0071_challenge_rewards.sql'),
    'utf8',
  );
  const out = new Set<string>();
  for (const m of sql.matchAll(
    /\{"kind":"(badge|theme|chain|frame|icon)","slug":"([a-z0-9-]+)"\}/g,
  )) {
    out.add(`${m[1]}:${m[2]}`);
  }
  return [...out].sort();
}

describe('the cosmetic catalog', () => {
  const seeded = seededCosmeticSlugs();

  it('parsed the migration at all', () => {
    // Guards the regex: a silently-empty parse makes every assertion below
    // vacuously true, which is the worst possible outcome for a drift test.
    expect(seeded.length).toBeGreaterThanOrEqual(9);
    expect(seeded).toContain('badge:year-one');
  });

  it('can draw every cosmetic the seeded ladder grants', () => {
    const known = new Set(knownCosmeticSlugs());
    const undrawable = seeded.filter((slug) => !known.has(slug));
    expect(undrawable).toEqual([]);
  });

  it('grants a badge on every rung of the seeded ladder', () => {
    // Nine rungs, nine badges. A rung that pays no badge is a rung whose only
    // evidence is a number that went up.
    expect(seeded.filter((s) => s.startsWith('badge:')).length).toBe(9);
  });

  it('has no cosmetic that no rung grants', () => {
    /*
     * The reverse direction, and it only warns in spirit — a catalog entry with
     * no rung behind it is unreachable art, which costs nothing at runtime but
     * is exactly what a half-finished season leaves lying around. Asserted
     * rather than logged because the set is small enough to keep honest, and
     * the day it stops being true is the day somebody meant to seed something
     * and did not.
     */
    const orphans = knownCosmeticSlugs().filter((slug) => !seeded.includes(slug));
    expect(orphans).toEqual([]);
  });
});

describe('catalog shapes', () => {
  it('gives every badge an icon the renderer knows', () => {
    const icons = new Set(['flame', 'sparkles', 'award', 'crown', 'shield', 'mountain', 'gem']);
    for (const [name, art] of Object.entries(BADGES)) {
      expect({ name, ok: icons.has(art.icon) }).toEqual({ name, ok: true });
    }
  });

  it('gives every colour a six-digit hex, so a screenshot carries it', () => {
    const hex = /^#[0-9a-f]{6}$/;
    const all = [
      ...Object.values(BADGES).flatMap((a) => [a.ink, a.ground]),
      ...Object.values(THEMES).flatMap((a) => [a.from, a.to]),
      ...Object.values(CHAINS).flatMap((a) => [a.kept, a.shielded, a.missed]),
      ...Object.values(FRAMES).flatMap((a) => [a.from, a.to]),
      DEFAULT_CHAIN.kept,
      DEFAULT_CHAIN.shielded,
      DEFAULT_CHAIN.missed,
    ];
    expect(all.filter((c) => !hex.test(c))).toEqual([]);
  });

  it('keeps the default chain identical to what the braid already drew', () => {
    // Introducing a skinning layer under a surface people recognise is only
    // safe if the unskinned case is byte-identical to what it replaced.
    expect(DEFAULT_CHAIN).toEqual({
      kept: '#9c92ff',
      shielded: '#2f2d48',
      missed: '#f4809c',
    });
  });
});

describe('parseSlug', () => {
  it('splits a well-formed slug', () => {
    expect(parseSlug('badge:spark')).toEqual({ kind: 'badge', name: 'spark' });
  });

  it('keeps everything after the first colon, so a name may contain one', () => {
    expect(parseSlug('premium:abc-123:90')).toEqual({ kind: 'premium', name: 'abc-123:90' });
  });

  it('returns null rather than throwing on anything malformed', () => {
    // This parses data that arrived over a network. A throw here is a crashed
    // trophy case, and the row it choked on is not worth one.
    for (const bad of ['', ':', 'badge:', ':spark', 'nocolon']) {
      expect(parseSlug(bad)).toBeNull();
    }
  });
});
