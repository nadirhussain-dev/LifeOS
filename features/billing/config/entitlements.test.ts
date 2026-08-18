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
    expect(Object.keys(seed.freemium).length).toBe(
      Object.keys(ENTITLEMENT_DEFAULTS).length,
    );
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
    expect(tierRank('freemium')).toBeLessThan(tierRank('standard'));
    expect(tierRank('standard')).toBeLessThan(tierRank('premium'));
  });

  it('ranks anything unrecognised below every real tier', () => {
    // Mirrors tier_rank()'s `else 0`. A tier arriving over the wire that this
    // build has never heard of must be the weakest, never the strongest.
    expect(tierRank('enterprise')).toBe(0);
    expect(tierRank('')).toBe(0);
    expect(tierRank('enterprise')).toBeLessThan(tierRank('freemium'));
  });

  it('answers atLeast the way has_premium() does', () => {
    expect(atLeast('freemium', 'standard')).toBe(false);
    expect(atLeast('standard', 'standard')).toBe(true);
    expect(atLeast('premium', 'standard')).toBe(true);
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
