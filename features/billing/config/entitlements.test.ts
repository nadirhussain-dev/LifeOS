import { readFileSync } from 'fs';
import { join } from 'path';

import {
  ENTITLEMENT_DEFAULTS,
  TIER_ENTITLEMENTS,
  TIERS,
  UNLIMITED,
  atLeast,
  parseEntitlements,
  parseTier,
  tierRank,
  withinLimit,
  type EntitlementKey,
} from './entitlements';

/**
 * Parses migration 0059's seed so the client's copy can be checked against it.
 *
 * Reading the SQL rather than restating it is the whole point: a matrix that
 * exists in two places drifts, and the drift is invisible — the server would
 * enforce one ceiling while the client rendered another, and whichever screen
 * happened to ask locally would be quietly wrong.
 */
function seedFromMigration(): Record<string, Record<string, number | boolean>> {
  const sql = readFileSync(
    join(__dirname, '../../../supabase/migrations/0059_plan_tiers_and_entitlements.sql'),
    'utf8',
  );
  const seed = sql.slice(sql.indexOf('insert into public.plan_entitlements'));
  const out: Record<string, Record<string, number | boolean>> = {};

  for (const m of seed.matchAll(/\('(\w+)',\s*'(\w+)',\s*to_jsonb\(([^)]+)\)/g)) {
    const [, tier, key, raw] = m;
    const literal = raw.replace('::bigint', '').trim();
    const value = literal === 'true' ? true : literal === 'false' ? false : Number(literal);
    (out[tier] ??= {})[key] = value;
  }
  return out;
}

describe('the entitlement matrix', () => {
  const seed = seedFromMigration();

  it('parsed the migration at all', () => {
    // Guards the regex above: a silently-empty parse would make every
    // comparison below vacuously pass.
    expect(Object.keys(seed).sort()).toEqual(['freemium', 'premium', 'standard']);
    expect(Object.keys(seed.freemium).length).toBe(Object.keys(ENTITLEMENT_DEFAULTS).length);
  });

  it('reflects 0073 deleting the middle tier, not just 0059 seeding it', () => {
    /*
     * 0059 seeds three tiers and 0073 deletes one of them, so the seed read
     * above is the matrix as it was *first written*, not as the database ends
     * up. Both files have to be consulted or this suite pins a shape that no
     * longer exists — the same pinned-migration trap that let a stale funnel
     * allowlist pass while client and server disagreed.
     *
     * Asserted rather than folded into the parse, because the two statements
     * are different: 0059 defined a standard column, and 0073 removed it.
     */
    const later = readFileSync(
      join(__dirname, '../../../supabase/migrations/0073_two_tiers_and_intervals.sql'),
      'utf8',
    );
    expect(later).toContain("delete from public.plan_entitlements where tier = 'standard'");
    expect(later).toContain("check (tier in ('freemium', 'premium'))");

    // And the client agrees with where that leaves things.
    expect([...TIERS].sort()).toEqual(['freemium', 'premium']);
    expect(Object.keys(TIER_ENTITLEMENTS).sort()).toEqual(['freemium', 'premium']);
  });

  for (const tier of TIERS) {
    it(`matches migration 0059's seed for ${tier}`, () => {
      expect(TIER_ENTITLEMENTS[tier]).toEqual(seed[tier]);
    });
  }

  it('falls back to freemium, never to a paid tier', () => {
    // The fail-safe direction. A cache miss showing an upsell to a paying
    // customer is corrected by the next refresh; handing Premium to everyone
    // whose network dropped is a free tier nobody agreed to.
    expect(ENTITLEMENT_DEFAULTS).toBe(TIER_ENTITLEMENTS.freemium);
    expect(ENTITLEMENT_DEFAULTS.media_backup).toBe(false);
    expect(ENTITLEMENT_DEFAULTS.ads).toBe(true);
  });
});

describe('tierRank', () => {
  it('orders the ladder', () => {
    expect(tierRank('freemium')).toBeLessThan(tierRank('premium'));
  });

  it('ranks anything unrecognised below every real tier', () => {
    // Mirrors tier_rank()'s `else 0`. A tier arriving over the wire that this
    // build has never heard of must be the weakest, never the strongest.
    expect(tierRank('enterprise')).toBe(0);
    expect(tierRank('')).toBe(0);
    expect(tierRank('enterprise')).toBeLessThan(tierRank('freemium'));
  });

  it('answers atLeast the way has_premium() does', () => {
    expect(atLeast('freemium', 'premium')).toBe(false);
    expect(atLeast('premium', 'premium')).toBe(true);
  });

  it('does not let a retired tier become an always-true threshold', () => {
    /*
     * The bug 0073 could most easily have shipped, on both sides at once.
     *
     * `tierRank` floors anything unrecognised at 0 — the safe direction for a
     * value being *ranked*, and the unsafe direction for one used as a
     * *threshold*. `atLeast(tier, 'standard')` was the paid check on the client
     * and `>= tier_rank('standard')` was the paid check on the server; the
     * moment that tier left the ladder both became `>= 0` and every free
     * account read as paid.
     *
     * Pinned as a property rather than a spelling: no retired or unknown name
     * may ever be usable as a floor that everything clears.
     */
    for (const retired of ['standard', 'enterprise', 'plus', '']) {
      expect(atLeast('freemium', retired as 'premium')).toBe(true);
      expect(tierRank(retired)).toBe(0);
    }
    // Which is exactly why the real check names a tier that still exists.
    expect(atLeast('freemium', 'premium')).toBe(false);
  });
});

describe('parseTier', () => {
  it('accepts the three tiers', () => {
    for (const tier of TIERS) expect(parseTier(tier)).toBe(tier);
  });

  it('degrades anything else to freemium', () => {
    for (const raw of ['enterprise', '', null, undefined, 7, {}]) {
      expect(parseTier(raw)).toBe('freemium');
    }
  });
});

describe('parseEntitlements', () => {
  it('reads a well-formed payload', () => {
    const parsed = parseEntitlements(TIER_ENTITLEMENTS.premium);
    expect(parsed).toEqual(TIER_ENTITLEMENTS.premium);
  });

  it('fills a missing key from freemium rather than leaving it undefined', () => {
    // The realistic failure: an operator adds a key for two tiers and forgets
    // the third. Degrading on that one key beats discarding a good payload.
    const partial = { ...TIER_ENTITLEMENTS.premium } as Record<string, unknown>;
    delete partial.voice_notes;
    const parsed = parseEntitlements(partial);
    expect(parsed.voice_notes).toBe(ENTITLEMENT_DEFAULTS.voice_notes);
    expect(parsed.storage_bytes).toBe(TIER_ENTITLEMENTS.premium.storage_bytes);
  });

  it('rejects a value of the wrong type', () => {
    const parsed = parseEntitlements({ media_backup: 'yes', album_limit: 'lots' });
    expect(parsed.media_backup).toBe(false);
    expect(parsed.album_limit).toBe(ENTITLEMENT_DEFAULTS.album_limit);
  });

  it('survives junk entirely', () => {
    for (const raw of [null, undefined, 'nope', 42]) {
      expect(parseEntitlements(raw)).toEqual(ENTITLEMENT_DEFAULTS);
    }
  });

  it('never leaves a key undefined', () => {
    const parsed = parseEntitlements({});
    for (const key of Object.keys(ENTITLEMENT_DEFAULTS) as EntitlementKey[]) {
      expect(parsed[key]).toBeDefined();
    }
  });
});

describe('withinLimit', () => {
  it('counts up to a real limit', () => {
    expect(withinLimit(0, 1)).toBe(true);
    expect(withinLimit(1, 1)).toBe(false);
    expect(withinLimit(4, 5)).toBe(true);
  });

  it('treats -1 as unlimited rather than as a limit of minus one', () => {
    // A plain `count < limit` would refuse Premium at the first album.
    expect(withinLimit(0, UNLIMITED)).toBe(true);
    expect(withinLimit(9999, UNLIMITED)).toBe(true);
  });
});
