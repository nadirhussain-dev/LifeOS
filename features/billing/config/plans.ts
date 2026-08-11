/**
 * Storage plans.
 *
 * The source of truth is `billing_plans` (migration 0034), fetched through
 * `usePlans()` (features/billing/hooks/use-billing.ts) — an admin can add,
 * price, and archive plans from the operator console's Pricing section
 * without a release. `STORAGE_PLANS` below is what that hook falls back to
 * on a network error or an empty table, mirroring the migration's own seed
 * row for row, so a fallback render looks identical to a normal one.
 *
 * `id` is no longer a closed union: `profiles.plan_id` is a foreign key
 * into `billing_plans` (0034), not a three-value check constraint, because
 * an admin adding a fourth plan has to result in something a user can
 * actually be assigned to. Everything that reads a plan id only ever
 * compares it against `'free'` — nothing needs the narrower type.
 */

export type StoragePlanId = string;
export type BillingPeriod = 'free' | 'month' | 'year';

export type StoragePlan = {
  id: StoragePlanId;
  name: string;
  storageBytes: number;
  priceCents: number;
  currency: string;
  period: BillingPeriod;
  /** Free text, admin-set. `'best_value'` gets the translated badge chip;
   *  anything else is shown verbatim, the same way a user-entered album
   *  name is never translated. */
  badge: string | null;
  /** Archived plans stay valid for whoever is already on them but are
   *  never offered to anyone choosing a new one — see `admin_set_plan_active`
   *  (0034). Always `true` on the hardcoded fallback below: there is no
   *  archived state to fall back to. */
  active: boolean;
};

const MB = 1024 * 1024;
const GB = 1024 * MB;

export const STORAGE_PLANS: StoragePlan[] = [
  {
    id: 'free',
    name: 'Free',
    storageBytes: 150 * MB,
    priceCents: 0,
    currency: 'usd',
    period: 'free',
    badge: null,
    active: true,
  },
  {
    id: 'plus_monthly',
    name: 'Plus',
    storageBytes: 50 * GB,
    priceCents: 499,
    currency: 'usd',
    period: 'month',
    badge: null,
    active: true,
  },
  {
    id: 'plus_yearly',
    name: 'Plus',
    // Same cap as monthly — the yearly plan's offer is the price, not more
    // space, so the two rows are an honest apples-to-apples comparison.
    storageBytes: 50 * GB,
    priceCents: 3999,
    currency: 'usd',
    period: 'year',
    badge: 'best_value',
    active: true,
  },
];

export function storagePlan(id: string, plans: StoragePlan[] = STORAGE_PLANS): StoragePlan {
  return plans.find((p) => p.id === id) ?? plans[0];
}

/** "$4.99". One currency (usd) for now — extend when a second is real. */
export function formatPrice(priceCents: number, currency = 'usd'): string {
  const amount = (priceCents / 100).toFixed(2);
  const symbol = currency.toLowerCase() === 'usd' ? '$' : `${currency.toUpperCase()} `;
  return `${symbol}${amount}`;
}

export function periodI18nKey(
  period: BillingPeriod,
): 'billing.free' | 'billing.perMonth' | 'billing.perYear' {
  if (period === 'month') return 'billing.perMonth';
  if (period === 'year') return 'billing.perYear';
  return 'billing.free';
}

/**
 * Mirrors of `free_album_limit()` / `free_album_member_limit()`
 * (supabase/migrations/0032_shared_album_plan_limits.sql) — display/precheck
 * values only. The migration's triggers are the actual enforcement; these
 * exist purely so the UI can decline to even show a form that would fail,
 * same relationship every other client-side check in this codebase has to
 * its server-side trigger (see 0026's header). If these two numbers and the
 * migration's ever disagree, the migration wins — a stale UI just shows an
 * upsell one album or member too early or too late, it can never let
 * through more than the server allows.
 */
export const FREE_ALBUM_LIMIT = 1;
export const FREE_ALBUM_MEMBER_LIMIT = 2;
