import {
  AD_FREE_DURATION_MS,
  grantAdFree,
  isAdFree,
  useAdFreeStore,
} from '@/features/ads/store/ad-free-store';

/**
 * The rewarded window.
 *
 * The property worth pinning hardest is that it does **not** stack. A reward
 * that accumulates is a currency, a currency gets farmed, and farmed rewards
 * are incentivised traffic whatever the app calls them — which is the thing
 * that costs an AdMob account rather than a metric.
 */
describe('the ad-free reward', () => {
  beforeEach(() => useAdFreeStore.setState({ until: null }));

  it('buys exactly one day', () => {
    const now = 1_000_000_000_000;
    grantAdFree(now);
    expect(useAdFreeStore.getState().until).toBe(now + AD_FREE_DURATION_MS);
  });

  it('suppresses ads while the window is open and stops the moment it closes', () => {
    const now = 1_000_000_000_000;
    grantAdFree(now);
    expect(isAdFree(now + AD_FREE_DURATION_MS - 1)).toBe(true);
    // Exactly at the boundary the window is over — `until` is an expiry, not a
    // last valid instant.
    expect(isAdFree(now + AD_FREE_DURATION_MS)).toBe(false);
  });

  it('does not stack: a second view restarts the clock rather than extending it', () => {
    const now = 1_000_000_000_000;
    grantAdFree(now);
    // An hour later, with twenty-three still on the clock.
    grantAdFree(now + 60 * 60 * 1000);
    expect(useAdFreeStore.getState().until).toBe(now + 60 * 60 * 1000 + AD_FREE_DURATION_MS);
    // Four views in a row must never buy four days.
    expect(useAdFreeStore.getState().until).toBeLessThan(now + 2 * AD_FREE_DURATION_MS);
  });

  it('shows ads when nothing has been granted', () => {
    expect(isAdFree()).toBe(false);
  });
});
