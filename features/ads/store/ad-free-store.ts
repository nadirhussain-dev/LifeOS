import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * A temporary ad-free window, bought with attention rather than money.
 *
 * ## What a rewarded ad is allowed to buy here
 *
 * Not a shield, and not a challenge day. `0048_streak_challenge.sql` forbids
 * that in writing — "no function that grants a shield or a day from an
 * advertising callback... the absence is the enforcement" — and
 * `docs/REWARDS_STRATEGY.md` §11 says the same. Google's policy on incentivised
 * traffic is the third reason and the one that costs the account rather than
 * the design. Beyond all three there is a product reason that outlives them: a
 * shield you can buy with thirty seconds of attention is not scarce, and a
 * streak that cannot break motivates nobody.
 *
 * So it buys the one thing that is honestly the app's to give and costs nobody
 * anything: a day without ads. It trades one impression for the eight or so it
 * suppresses, which is a bad deal on paper and a good one in practice — the
 * people who take it are the people who were never going to subscribe and were
 * going to resent the banners either way.
 *
 * ## Local, and deliberately not synced
 *
 * A window that expires tomorrow is not worth a table, an RPC or a sync
 * conflict, and putting it on the server would make "watch an ad, get
 * something" a thing the server grants — which is the exact shape 0048 refuses
 * to build. Losing it by reinstalling costs the user one ad.
 */
type AdFreeState = {
  /** Epoch milliseconds until which no ads are shown, or null. */
  until: number | null;
  hydrated: boolean;

  /** Extends the window from *now*, never stacking beyond one period — see
   *  `grantAdFree` for why. */
  grant: (durationMs: number, now?: number) => void;
};

export const useAdFreeStore = create<AdFreeState>()(
  persist(
    (set) => ({
      until: null,
      hydrated: false,

      grant: (durationMs, now = Date.now()) => set({ until: now + durationMs }),
    }),
    {
      name: 'ad-free-store',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ hydrated: _hydrated, ...rest }) => rest,
      onRehydrateStorage: () => () => {
        useAdFreeStore.setState({ hydrated: true });
      },
    },
  ),
);

/** How long one rewarded view buys. */
export const AD_FREE_DURATION_MS = 24 * 60 * 60 * 1000;

/**
 * Whether ads are currently suppressed by a reward.
 *
 * A plain function rather than a selector so the non-React callers — the ad
 * gate, the banner — can ask without a hook. Reads `Date.now()` each time
 * rather than caching an expiry check, because this is asked once per ad
 * decision and a cached answer is one that goes stale exactly when it matters.
 */
export function isAdFree(now = Date.now()): boolean {
  const until = useAdFreeStore.getState().until;
  return until !== null && until > now;
}

/**
 * Starts a fresh window from now.
 *
 * Deliberately not additive. Watching four ads in a row must not buy four days
 * — that turns a courtesy into a currency to be farmed, and a farmed reward is
 * incentivised traffic whatever it is called. Re-watching simply restarts the
 * clock, which is worth nothing to somebody who already has twenty hours left.
 */
export function grantAdFree(now = Date.now()): void {
  useAdFreeStore.getState().grant(AD_FREE_DURATION_MS, now);
}
