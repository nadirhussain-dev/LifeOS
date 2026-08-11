/**
 * Storage plans — mock, for now.
 *
 * There is no payment provider wired up (see billing-store.ts): this is the
 * catalogue the upgrade screen renders and the thing a future real
 * integration would replace the "subscribe" call under, not something that
 * charges anyone today. `storageBytes` for `free` mirrors
 * `media_quota_bytes()` (supabase/migrations/0030_lower_media_quota_for_free_tier.sql)
 * as a display fallback only — wherever the real quota is available
 * (Settings → Media & Storage) that live number is what's shown, this is
 * just what to say before it has loaded.
 *
 * The Plus numbers are aspirational, not provisioned: 50 GB per paid account
 * is a target for once billing is real and the project has moved off the
 * Supabase free plan (whose 1 GB *project-wide* storage cap is the entire
 * reason `free` dropped to 150 MB — see 0030's header). Selling a plan the
 * infrastructure can't yet back is fine for a preview; shipping it for real
 * money before that migration happens is not.
 */

export type StoragePlanId = 'free' | 'plus_monthly' | 'plus_yearly';

export type StoragePlan = {
  id: StoragePlanId;
  storageBytes: number;
  priceLabel: string;
  periodKey: 'billing.free' | 'billing.perMonth' | 'billing.perYear';
  badgeKey?: 'billing.bestValue';
};

const MB = 1024 * 1024;
const GB = 1024 * MB;

export const STORAGE_PLANS: StoragePlan[] = [
  {
    id: 'free',
    storageBytes: 150 * MB,
    priceLabel: '$0',
    periodKey: 'billing.free',
  },
  {
    id: 'plus_monthly',
    storageBytes: 50 * GB,
    priceLabel: '$4.99',
    periodKey: 'billing.perMonth',
  },
  {
    id: 'plus_yearly',
    // Same cap as monthly — the yearly plan's offer is the price, not more
    // space, so the two rows are an honest apples-to-apples comparison.
    storageBytes: 50 * GB,
    priceLabel: '$39.99',
    periodKey: 'billing.perYear',
    badgeKey: 'billing.bestValue',
  },
];

export function storagePlan(id: StoragePlanId): StoragePlan {
  return STORAGE_PLANS.find((p) => p.id === id) ?? STORAGE_PLANS[0];
}
