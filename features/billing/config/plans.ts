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
export type BillingPeriod = 'free' | 'month' | 'quarter' | 'year';

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
    // Mirrors billing_plans's seeded 'free' row — see 0037_media_quota_from_
    // plan.sql for why 50MB and where it's actually enforced (shared albums;
    // cloud media backup itself requires a paid plan outright, per 0035).
    storageBytes: 50 * MB,
    priceCents: 0,
    currency: 'usd',
    period: 'free',
    badge: null,
    active: true,
  },
  /*
   * The three Premium intervals, mirroring 0073's seed.
   *
   * Same storage on all three — the offer is the price, not more space, so the
   * rows are an honest apples-to-apples comparison. Storage is sold separately
   * and priced by the admin; these buy ad removal and the media capabilities
   * that come with a paid account.
   *
   * Priced in paisa, because that is what `price_cents` holds and what Safepay
   * is handed after `toSafepayAmount` divides by 100.
   */
  {
    id: 'premium_monthly',
    name: 'Premium',
    storageBytes: 100 * GB,
    priceCents: 34900,
    currency: 'pkr',
    period: 'month',
    badge: null,
    active: true,
  },
  {
    id: 'premium_quarterly',
    name: 'Premium',
    storageBytes: 100 * GB,
    priceCents: 92900,
    currency: 'pkr',
    period: 'quarter',
    badge: null,
    active: true,
  },
  {
    id: 'premium_yearly',
    name: 'Premium',
    storageBytes: 100 * GB,
    priceCents: 314900,
    currency: 'pkr',
    period: 'year',
    badge: 'best_value',
    active: true,
  },
];

export function storagePlan(id: string, plans: StoragePlan[] = STORAGE_PLANS): StoragePlan {
  return plans.find((p) => p.id === id) ?? plans[0];
}

/**
 * "Rs 349", "$4.99".
 *
 * PKR is written without the decimals, because it is charged without them: the
 * ladder is whole rupees, every Pakistani price tag in the wild reads "Rs 349",
 * and ".00" on all three plans is two characters of noise on the one screen
 * where the number is the message. The digits are still *stored* — price_cents
 * is paisa — so a future half-rupee price is a formatting change and not a
 * migration.
 *
 * Anything else falls back to the code plus two decimals, which is wrong-looking
 * enough to notice and never wrong about the amount.
 */
export function formatPrice(priceCents: number, currency = 'usd'): string {
  const code = currency.toLowerCase();
  if (code === 'pkr') {
    const rupees = Math.round(priceCents / 100);
    return `Rs ${rupees.toLocaleString('en-US')}`;
  }
  const amount = (priceCents / 100).toFixed(2);
  const symbol = code === 'usd' ? '$' : `${currency.toUpperCase()} `;
  return `${symbol}${amount}`;
}

export function periodI18nKey(
  period: BillingPeriod,
): 'billing.free' | 'billing.perMonth' | 'billing.perQuarter' | 'billing.perYear' {
  if (period === 'month') return 'billing.perMonth';
  if (period === 'quarter') return 'billing.perQuarter';
  if (period === 'year') return 'billing.perYear';
  return 'billing.free';
}

/**
 * How many months a period covers, so two plans can be compared honestly.
 *
 * A quarterly price is not comparable to a monthly one until both are
 * per-month, and "Rs 929" beside "Rs 349" reads as three times worse when it is
 * eleven percent better. Mirrors `chargesPerYear` in
 * supabase/functions/_shared/interval.ts — the server bills on that table and
 * the paywall quotes from this one, so they describe the same fact.
 */
export function monthsInPeriod(period: BillingPeriod): number {
  if (period === 'month') return 1;
  if (period === 'quarter') return 3;
  if (period === 'year') return 12;
  return 0;
}

/**
 * The per-month price, for the "Rs 262/mo" line under a longer plan.
 *
 * Returns null for a free plan rather than 0: there is no monthly equivalent of
 * free, and rendering "Rs 0/mo" beside it invites the comparison the whole line
 * exists to make fair.
 */
export function perMonthCents(plan: StoragePlan): number | null {
  const months = monthsInPeriod(plan.period);
  return months > 0 ? Math.round(plan.priceCents / months) : null;
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
