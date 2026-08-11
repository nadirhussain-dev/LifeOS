import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { albumKeys } from '@/features/private/hooks/use-shared-albums';
import { useAuthStore } from '@/features/auth/services/auth-store';
import {
  STORAGE_PLANS,
  type StoragePlan,
  type StoragePlanId,
} from '@/features/billing/config/plans';
import {
  adminSetPlanActive,
  adminUpsertPlan,
  fetchMyPlan,
  fetchPlans,
  setMyPlan,
  type UpsertPlanInput,
} from '@/features/billing/services/billing-repository';
import { useBillingStore } from '@/features/billing/store/billing-store';

/**
 * Keeps the plan cache fresh — same shape as
 * `use-account-standing.ts`'s `useAccountStandingSync`: once when a session
 * appears, again on every foreground, cleared on sign-out. Mount once, at
 * the root (`app/_layout.tsx`), not per-screen.
 *
 * Guests have no `profiles` row and so no plan — they read as `free`
 * locally without a round trip, same as media.tsx already treats a
 * signed-out account as unable to use anything cloud-shaped.
 */
export function useBillingSync() {
  const session = useAuthStore((s) => s.session);
  const userId = useAuthStore((s) => s.user?.id ?? null);

  useEffect(() => {
    if (!session || !userId) {
      useBillingStore.getState().clear();
      return;
    }
    void refresh(userId);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh(userId);
    });
    return () => sub.remove();
  }, [session, userId]);
}

async function refresh(userId: string): Promise<void> {
  try {
    const { planId, renewsAt } = await fetchMyPlan(userId);
    useBillingStore.getState().setPlan(planId, renewsAt);
  } catch {
    // Offline or a transient failure — the cached value from the last
    // successful check stands, same reasoning as account-standing's cache.
  }
}

/** Reactive plan for UI — `isPlus` is the one flag most screens actually
 *  need, so callers don't all re-derive `planId !== 'free'` themselves. */
export function usePlan(): {
  planId: StoragePlanId;
  isPlus: boolean;
  mockRenewsAt: number | null;
} {
  const planId = useBillingStore((s) => s.planId);
  const mockRenewsAt = useBillingStore((s) => s.mockRenewsAt);
  return { planId, isPlus: planId !== 'free', mockRenewsAt };
}

/**
 * The live plan catalogue (0034), with the hardcoded `STORAGE_PLANS` as the
 * fallback on error or an empty table — never leaves the pricing screen
 * with nothing to render, same fail-safe posture as `module-flags.ts`'s
 * "never quietly hand back nothing on a flaky connection."
 */
export function usePlans() {
  return useQuery({
    queryKey: ['billing', 'plans'],
    queryFn: fetchPlans,
    placeholderData: STORAGE_PLANS,
    select: (plans) => (plans.length > 0 ? plans : STORAGE_PLANS),
  });
}

/**
 * The mock "subscribe" action — writes through `set_my_plan` (0031/0034),
 * then refreshes the cache and anything whose limits depend on the plan
 * (shared albums' own-count is the one thing currently gated by it). No
 * payment is taken; the confirm dialog in front of this call is what says
 * "preview". Takes the whole plan, not just its id, so the mock renewal
 * date is computed from the plan's own `period` rather than pattern-matching
 * a hardcoded id — an admin-created plan gets the same treatment as the
 * seeded ones.
 */
export function useSubscribeMutation() {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (plan: StoragePlan) => {
      const days = plan.period === 'year' ? 365 : plan.period === 'month' ? 30 : null;
      const renewsAt = days === null ? null : Date.now() + days * 86_400_000;
      await setMyPlan(plan.id, renewsAt);
      return { planId: plan.id, renewsAt };
    },
    onSuccess: ({ planId, renewsAt }) => {
      useBillingStore.getState().setPlan(planId, renewsAt);
      if (userId) void queryClient.invalidateQueries({ queryKey: albumKeys.list });
    },
  });
}

/** Admin-only (0034) — create or edit a plan. */
export function useAdminUpsertPlanMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpsertPlanInput) => adminUpsertPlan(input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['billing', 'plans'] }),
  });
}

/** Admin-only (0034) — archive/restore a plan. */
export function useAdminSetPlanActiveMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => adminSetPlanActive(id, active),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['billing', 'plans'] }),
  });
}
