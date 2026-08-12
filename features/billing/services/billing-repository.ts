import type { BillingPeriod, StoragePlan, StoragePlanId } from '@/features/billing/config/plans';
import { supabase } from '@/lib/supabase';
import { toSupabaseError } from '@/lib/supabase-error';

/**
 * Supabase access for the mock billing plan (migration 0031) and the
 * `billing_plans` catalogue an admin manages (migration 0034).
 *
 * "Mock" describes the payment, not the enforcement: `set_my_plan` really
 * does write the row that 0032's triggers check before letting a free
 * account create a second shared album or a third member, and it really
 * does validate against `billing_plans` rather than a hardcoded list.
 * Nothing here verifies a card or a receipt — that is the one thing a real
 * integration would add later, in exactly this file, behind the same
 * functions.
 */

export type PlanRow = { planId: StoragePlanId; renewsAt: number | null };

function toPlanRow(row: { plan_id: string; plan_renews_at: number | null } | null): PlanRow {
  return { planId: row?.plan_id ?? 'free', renewsAt: row?.plan_renews_at ?? null };
}

export async function fetchMyPlan(userId: string): Promise<PlanRow> {
  const res = await supabase
    .from('profiles')
    .select('plan_id, plan_renews_at')
    .eq('id', userId)
    .maybeSingle();
  if (res.error) throw toSupabaseError(res.error);
  return toPlanRow(res.data);
}

export async function setMyPlan(planId: StoragePlanId, renewsAt: number | null): Promise<void> {
  const { error } = await supabase.rpc('set_my_plan', {
    p_plan_id: planId,
    p_renews_at: renewsAt,
  });
  if (error) throw toSupabaseError(error);
}

function toStoragePlan(row: Record<string, unknown>): StoragePlan {
  return {
    id: String(row.id ?? ''),
    name: String(row.name ?? ''),
    storageBytes: Number(row.storage_bytes ?? 0),
    priceCents: Number(row.price_cents ?? 0),
    currency: String(row.currency ?? 'usd'),
    period: (row.period as BillingPeriod) ?? 'month',
    badge: (row.badge as string | null) ?? null,
    active: row.active !== false,
  };
}

/** The live catalogue. Callers fall back to `STORAGE_PLANS` (plans.ts) on
 *  error or an empty result — see `usePlans()`, which is what every screen
 *  actually calls. */
export async function fetchPlans(): Promise<StoragePlan[]> {
  const res = await supabase.from('billing_plans').select('*').order('sort_order');
  if (res.error) throw toSupabaseError(res.error);
  return (res.data ?? []).map(toStoragePlan);
}

export type UpsertPlanInput = {
  id: string;
  name: string;
  storageBytes: number;
  priceCents: number;
  currency: string;
  period: BillingPeriod;
  badge: string | null;
  sortOrder: number;
};

/** Admin-only (0034) — creates a new plan or edits an existing one in place. */
export async function adminUpsertPlan(input: UpsertPlanInput): Promise<void> {
  const { error } = await supabase.rpc('admin_upsert_plan', {
    p_id: input.id,
    p_name: input.name,
    p_storage_bytes: input.storageBytes,
    p_price_cents: input.priceCents,
    p_currency: input.currency,
    p_period: input.period,
    p_badge: input.badge,
    p_sort_order: input.sortOrder,
  });
  if (error) throw toSupabaseError(error);
}

/** Admin-only (0034) — archive/restore. Never a hard delete: an archived
 *  plan stays valid for whoever is already on it. */
export async function adminSetPlanActive(id: string, active: boolean): Promise<void> {
  const { error } = await supabase.rpc('admin_set_plan_active', { p_id: id, p_active: active });
  if (error) throw toSupabaseError(error);
}

// --- real billing (0044/0045/0046) ------------------------------------------
//
// Everything below replaces the mock `setMyPlan` write with the actual
// Safepay flow: `safepay-checkout` starts a subscription, `safepay-webhook`
// (never called from the client) is what actually confirms it, and
// `my_subscription()` (0044) is the one-row read of where that landed.

export type SubscriptionStatus =
  | 'pending'
  | 'active'
  | 'past_due'
  | 'pending_renewal_confirmation'
  | 'cancelled';

export type MySubscription = {
  safepaySubscriptionId: string;
  planId: string;
  couponId: string | null;
  cyclesRemaining: number | null;
  status: SubscriptionStatus;
  currentPeriodEnd: number | null;
};

export async function fetchMySubscription(): Promise<MySubscription | null> {
  const { data, error } = await supabase.rpc('my_subscription');
  if (error) throw toSupabaseError(error);
  const row = (data ?? [])[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    safepaySubscriptionId: String(row.safepay_subscription_id ?? ''),
    planId: String(row.plan_id ?? ''),
    couponId: (row.coupon_id as string | null) ?? null,
    cyclesRemaining: (row.cycles_remaining as number | null) ?? null,
    status: (row.status as SubscriptionStatus) ?? 'pending',
    currentPeriodEnd: (row.current_period_end as number | null) ?? null,
  };
}

/**
 * Starts a real Safepay subscription checkout. Returns the URL to open with
 * `WebBrowser.openAuthSessionAsync` — the same pattern
 * `features/auth/services/oauth.ts`'s `signInWithGoogle` already uses for
 * Google sign-in, so no new native config is needed.
 */
export async function createCheckout(planId: string, couponCode?: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke('safepay-checkout', {
    body: { planId, couponCode: couponCode?.trim() || undefined },
  });
  if (error) throw toSupabaseError(error);
  const url = (data as { checkoutUrl?: string } | null)?.checkoutUrl;
  if (!url) throw new Error((data as { error?: string } | null)?.error ?? 'checkout failed');
  return url;
}

/** Requests cancellation. Does not change local state — the subscription
 *  stays as-is until the resulting webhook flips it (see fetchMySubscription
 *  and useBillingSync). */
export async function cancelMySubscription(): Promise<void> {
  const { data, error } = await supabase.functions.invoke('safepay-cancel-subscription');
  if (error) throw toSupabaseError(error);
  const err = (data as { error?: string } | null)?.error;
  if (err) throw new Error(err);
}
