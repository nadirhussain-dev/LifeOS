import type { StoragePlanId } from '@/features/billing/config/plans';
import { supabase } from '@/lib/supabase';
import { toSupabaseError } from '@/lib/supabase-error';

/**
 * Supabase access for the mock billing plan (migration 0031).
 *
 * "Mock" describes the payment, not the enforcement: `set_my_plan` really
 * does write the row that 0032's triggers check before letting a free
 * account create a second shared album or a third member. Nothing here
 * verifies a card or a receipt — that is the one thing a real integration
 * would add later, in exactly this file, behind the same two functions.
 */

export type PlanRow = { planId: StoragePlanId; renewsAt: number | null };

function toPlanRow(row: { plan_id: string; plan_renews_at: number | null } | null): PlanRow {
  const known: StoragePlanId[] = ['free', 'plus_monthly', 'plus_yearly'];
  const planId =
    row && known.includes(row.plan_id as StoragePlanId) ? (row.plan_id as StoragePlanId) : 'free';
  return { planId, renewsAt: row?.plan_renews_at ?? null };
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
