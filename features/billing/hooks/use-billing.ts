import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { albumKeys } from '@/features/private/hooks/use-shared-albums';
import { useAuthStore } from '@/features/auth/services/auth-store';
import type { StoragePlanId } from '@/features/billing/config/plans';
import { fetchMyPlan, setMyPlan } from '@/features/billing/services/billing-repository';
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
 * The mock "subscribe" action — writes through `set_my_plan` (0031), then
 * refreshes the cache and anything whose limits depend on the plan (shared
 * albums' own-count is the one thing currently gated by it). No payment is
 * taken; the confirm dialog in front of this call is what says "preview".
 */
export function useSubscribeMutation() {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (planId: StoragePlanId) => {
      const renewsAt =
        planId === 'free' ? null : Date.now() + (planId === 'plus_yearly' ? 365 : 30) * 86_400_000;
      await setMyPlan(planId, renewsAt);
      return { planId, renewsAt };
    },
    onSuccess: ({ planId, renewsAt }) => {
      useBillingStore.getState().setPlan(planId, renewsAt);
      if (userId) void queryClient.invalidateQueries({ queryKey: albumKeys.list });
    },
  });
}
