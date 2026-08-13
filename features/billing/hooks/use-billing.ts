import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { useAuthStore } from '@/features/auth/services/auth-store';
import {
  STORAGE_PLANS,
  type StoragePlan,
  type StoragePlanId,
} from '@/features/billing/config/plans';
import {
  adminSetPlanActive,
  adminUpsertPlan,
  cancelMySubscription,
  createCheckout,
  fetchMyPlan,
  fetchMySubscription,
  fetchPlans,
  type MySubscription,
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
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!session || !userId) {
      useBillingStore.getState().clear();
      return;
    }
    void refresh(userId);
    // Also where a real subscription's status catches up after a Safepay
    // checkout — the browser sheet closing and the app foregrounding is the
    // one reliable moment to check, since safepay-webhook writes on its own
    // schedule with no way to push a result to this device directly.
    void queryClient.invalidateQueries({ queryKey: ['billing', 'subscription'] });
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void refresh(userId);
        void queryClient.invalidateQueries({ queryKey: ['billing', 'subscription'] });
      }
    });
    return () => sub.remove();
  }, [session, userId, queryClient]);
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
 * The real subscription row (0047), read through `my_subscription()`. Not
 * cached in `billing-store.ts` the way `planId` is — this is queried live
 * because it's read far less often (one settings screen) and needs to be
 * fresher than the plan cache, not more durable.
 */
export function useMySubscription() {
  const session = useAuthStore((s) => s.session);
  return useQuery({
    queryKey: ['billing', 'subscription'],
    queryFn: fetchMySubscription,
    enabled: !!session,
  });
}

/** True once a coupon's `duration_cycles` has run out and Safepay would
 *  otherwise renew at full price — see safepay-webhook's header for why
 *  this is a one-tap reconfirmation rather than a silent price change. */
export function usePendingRenewalConfirmation(subscription: MySubscription | null): boolean {
  return subscription?.status === 'pending_renewal_confirmation';
}

/**
 * Starts a real Safepay checkout for `plan`, optionally with a coupon code.
 * Returns the checkout URL for the caller to open with
 * `WebBrowser.openAuthSessionAsync` — this mutation only creates the
 * checkout, it never grants the plan itself. The plan only changes once
 * `safepay-webhook` says so; `useBillingSync`'s foreground refresh is what
 * eventually picks that up.
 */
export function useCreateCheckoutMutation() {
  return useMutation({
    mutationFn: ({ plan, couponCode }: { plan: StoragePlan; couponCode?: string }) =>
      createCheckout(plan.id, couponCode),
  });
}

/** Requests cancellation at Safepay. Local state changes only once the
 *  resulting webhook lands — see cancelMySubscription's own header. */
export function useCancelSubscriptionMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: cancelMySubscription,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['billing', 'subscription'] }),
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
