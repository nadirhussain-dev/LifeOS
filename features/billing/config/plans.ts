/**
 * Storage plans — mock, for now.
 *
 * There is no payment provider wired up (see billing-store.ts): this is the
 * catalogue the upgrade screen renders and the thing a future real
 * integration would replace the "subscribe" call under, not something that
 * charges anyone today. `storageBytes` for `free` mirrors
 * `media_quota_bytes()` (supabase/migrations/0026_media_storage.sql) as a
 * display fallback only — wherever the real quota is available (Settings →
 * Media & Storage) that live number is what's shown, this is just what to
 * say before it has loaded.
 */

export type StoragePlanId = 'free' | 'plus_monthly' | 'plus_yearly';

export type StoragePlan = {
  id: StoragePlanId;
  storageBytes: number;
  priceLabel: string;
  periodKey: 'billing.free' | 'billing.perMonth' | 'billing.perYear';
  badgeKey?: 'billing.bestValue';
};

const GB = 1024 * 1024 * 1024;

export const STORAGE_PLANS: StoragePlan[] = [
  {
    id: 'free',
    storageBytes: 2 * GB,
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
