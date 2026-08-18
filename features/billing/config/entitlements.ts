/**
 * What a tier includes.
 *
 * The source of truth is `plan_entitlements` (migration 0059), read through
 * `my_billing_state()` and cached in `billing-store.ts`. This file is the
 * typed view of that table plus the fallback used before the first round trip
 * has landed, or when it fails — the same relationship `STORAGE_PLANS`
 * (plans.ts) already has to `billing_plans`.
 *
 * The fallback is the **freemium** row, deliberately. A cache miss or a flaky
 * connection must never hand out a paid capability: the worst a wrong fallback
 * can do is show an upsell to somebody who has already paid, which the next
 * successful refresh corrects. The reverse — granting Premium to everyone
 * whose network dropped — is a free tier nobody agreed to.
 */

export const TIERS = ['freemium', 'standard', 'premium'] as const;
export type Tier = (typeof TIERS)[number];

/**
 * Mirrors `tier_rank()` (0059). Anything unrecognised ranks 0 — the weakest,
 * never accidentally the strongest, which is the only safe direction for a
 * value that arrives over the wire.
 */
export function tierRank(tier: string): number {
  const i = (TIERS as readonly string[]).indexOf(tier);
  return i < 0 ? 0 : i + 1;
}

export function atLeast(tier: string, minimum: Tier): boolean {
  return tierRank(tier) >= tierRank(minimum);
}

/**
 * `-1` means unlimited, never `null` — a missing key has to read as "not
 * configured, deny", and null and absent are too easy to confuse in the
 * comparison that decides whether somebody may upload. Mirrors the migration's
 * own reasoning.
 */
export const UNLIMITED = -1;

export type Entitlements = {
  storage_bytes: number;
  media_backup: boolean;
  album_limit: number;
  album_member_limit: number;
  avatar_upload: boolean;
  album_media_upload: boolean;
  voice_notes: boolean;
  /** True means ads are *shown*. Named for the capability, not its absence,
   *  so the table reads the same way in every row. */
  ads: boolean;
  insights: boolean;
  on_this_day_years: number;
};

export type EntitlementKey = keyof Entitlements;

const MB = 1024 * 1024;
const GB = 1024 * MB;

/** Row for row identical to migration 0059's seed. Asserted by
 *  entitlements.test.ts — if the two ever disagree, that test fails rather
 *  than a user quietly getting the wrong ceiling. */
export const TIER_ENTITLEMENTS: Record<Tier, Entitlements> = {
  freemium: {
    storage_bytes: 50 * MB,
    media_backup: false,
    album_limit: 1,
    album_member_limit: 2,
    avatar_upload: false,
    album_media_upload: false,
    voice_notes: false,
    ads: true,
    insights: false,
    on_this_day_years: 1,
  },
  standard: {
    storage_bytes: 15 * GB,
    media_backup: true,
    album_limit: 5,
    album_member_limit: 10,
    avatar_upload: true,
    album_media_upload: true,
    voice_notes: false,
    ads: false,
    insights: true,
    on_this_day_years: 5,
  },
  premium: {
    storage_bytes: 100 * GB,
    media_backup: true,
    album_limit: UNLIMITED,
    album_member_limit: UNLIMITED,
    avatar_upload: true,
    album_media_upload: true,
    voice_notes: true,
    ads: false,
    insights: true,
    on_this_day_years: 15,
  },
};

/** See the header: freemium, on purpose. */
export const ENTITLEMENT_DEFAULTS: Entitlements = TIER_ENTITLEMENTS.freemium;

/**
 * Coerces one server value into the shape this app expects, falling back to
 * the freemium default for anything missing or of the wrong type.
 *
 * Per-key rather than a whole-object validation because a partial response is
 * the realistic failure — an operator adds a key to `plan_entitlements` for
 * two tiers and forgets the third, and the client should degrade on that one
 * key rather than discard an otherwise good payload.
 */
function coerce<K extends EntitlementKey>(key: K, raw: unknown): Entitlements[K] {
  const fallback = ENTITLEMENT_DEFAULTS[key];
  if (typeof fallback === 'boolean') {
    return (typeof raw === 'boolean' ? raw : fallback) as Entitlements[K];
  }
  return (typeof raw === 'number' && Number.isFinite(raw) ? raw : fallback) as Entitlements[K];
}

export function parseEntitlements(raw: unknown): Entitlements {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const out = { ...ENTITLEMENT_DEFAULTS };
  for (const key of Object.keys(ENTITLEMENT_DEFAULTS) as EntitlementKey[]) {
    // `coerce` returns the right type for its key by construction, but TS
    // cannot follow that through a union-typed index — `out[key]` narrows to
    // `never`. Widened once, here, rather than casting at each call site.
    (out as Record<string, unknown>)[key] = coerce(key, obj[key]);
  }
  return out;
}

export function parseTier(raw: unknown): Tier {
  return (TIERS as readonly string[]).includes(raw as string) ? (raw as Tier) : 'freemium';
}

/** `-1` is unlimited, so a plain `count < limit` would be wrong for Premium. */
export function withinLimit(count: number, limit: number): boolean {
  return limit === UNLIMITED || count < limit;
}
