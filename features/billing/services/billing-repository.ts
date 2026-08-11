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
