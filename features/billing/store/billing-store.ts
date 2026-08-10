import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { StoragePlanId } from '@/features/billing/config/plans';

/**
 * Mock subscription state.
 *
 * No payment provider is wired up. `subscribe()` flips `planId` and stamps a
 * fake renewal date, entirely on-device — nothing here talks to a server,
 * charges a card, or is enforced anywhere (the real storage quota is still
 * whatever `media_quota_bytes()` returns server-side, unaffected by this).
 * It exists so the pricing screen has real local state to show and toggle
 * ahead of a real billing integration, and so that integration has exactly
 * one place to replace (`subscribe`) rather than a UI wired directly to
 * nothing. The upgrade screen says "preview" out loud — this store is why
 * that word is accurate.
 */
type BillingState = {
  planId: StoragePlanId;
  /** Set only by `subscribe()`, for display only ("renews on ..."). */
  mockRenewsAt: number | null;
  subscribe: (planId: StoragePlanId) => void;
  cancel: () => void;
};

const DAY_MS = 86_400_000;

export const useBillingStore = create<BillingState>()(
  persist(
    (set) => ({
      planId: 'free',
      mockRenewsAt: null,
      subscribe: (planId) =>
        set({
          planId,
          mockRenewsAt:
            planId === 'free' ? null : Date.now() + (planId === 'plus_yearly' ? 365 : 30) * DAY_MS,
        }),
      cancel: () => set({ planId: 'free', mockRenewsAt: null }),
    }),
    {
      name: 'billing-store',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
