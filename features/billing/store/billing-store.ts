import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { StoragePlanId } from '@/features/billing/config/plans';

/**
 * A cache of the account's plan, never the authority on it.
 *
 * Migration 0031 made `profiles.plan_id` the source of truth — the same
 * column 0032's triggers check before letting a free account create a
 * second shared album or a third member — specifically because a purely
 * local, per-device plan could disagree with itself across two phones on
 * the same account, and couldn't be enforced by anything server-side
 * anyway. This store exists so the UI has something to render instantly on
 * a cold start, before `useBillingSync()` (use-billing.ts) has finished its
 * first round trip — same relationship `moderation-store.ts` has to the
 * server's standing verdict.
 */
type BillingState = {
  planId: StoragePlanId;
  mockRenewsAt: number | null;
  /** When the cache was last refreshed from the server — never trust a
   *  cache that's never been checked. */
  checkedAt: number | null;
  setPlan: (planId: StoragePlanId, renewsAt: number | null) => void;
  clear: () => void;
};

export const useBillingStore = create<BillingState>()(
  persist(
    (set) => ({
      planId: 'free',
      mockRenewsAt: null,
      checkedAt: null,
      setPlan: (planId, renewsAt) => set({ planId, mockRenewsAt: renewsAt, checkedAt: Date.now() }),
      // Signing out on a shared device must not leave the next account
      // reading a stale "Plus" cache that was never theirs.
      clear: () => set({ planId: 'free', mockRenewsAt: null, checkedAt: null }),
    }),
    {
      name: 'billing-store',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
