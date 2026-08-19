import { Platform } from 'react-native';

import { loadAdsModule } from '@/features/ads/services/ads-module';
import { grantAdFree } from '@/features/ads/store/ad-free-store';
import { env } from '@/lib/env';

/**
 * The rewarded ad, and the one thing it is allowed to buy.
 *
 * See `ad-free-store.ts` for why the reward is a day without ads and never a
 * shield or a challenge day. This file is only the mechanics.
 *
 * ## Three policy rules this shape exists to satisfy
 *
 * A rewarded ad is the format with the most rules attached, and all three are
 * structural rather than cosmetic:
 *
 *  1. **The user opts in, explicitly.** It is never shown by a pacing rule or a
 *     navigation event. There is one entry point and it is a button somebody
 *     pressed, which is why `showRewarded` takes no breakpoint and consults no
 *     pacing — the honeymoon and the session cap are about ads people did not
 *     ask for.
 *  2. **The reward is disclosed before the ad, not after.** The button says
 *     what it buys; this file never has to explain itself afterwards.
 *  3. **The reward is for watching, not for clicking.** It is granted on the
 *     SDK's `EARNED_REWARD` event and nowhere else. Granting on `closed` would
 *     pay somebody who dismissed it, and granting on any click-derived signal
 *     is the definition of incentivised traffic.
 *
 * Consent still applies — an ad request under an unanswered UMP form is an ad
 * request either way — so `isRewardedAvailable` requires it before offering
 * anything at all.
 */

type RewardedLike = {
  addAdEventListener: (type: string, handler: () => void) => () => void;
  load: () => void;
  show: () => Promise<void>;
  loaded: boolean;
};

let ad: RewardedLike | null = null;
let ready = false;

function unitId(): string | null {
  const mod = loadAdsModule();
  if (!mod) return null;
  const real =
    Platform.OS === 'ios'
      ? env.EXPO_PUBLIC_ADMOB_REWARDED_UNIT_ID_IOS
      : env.EXPO_PUBLIC_ADMOB_REWARDED_UNIT_ID_ANDROID;
  return real || mod.TestIds.REWARDED;
}

/**
 * Preloads one. Called when a surface that offers the reward appears, not at
 * startup — an ad nobody is going to be offered is a request nobody needed.
 */
export function preloadRewarded(): void {
  if (ad !== null) return;
  const mod = loadAdsModule();
  const id = unitId();
  if (!mod || !id) return;

  try {
    const created = mod.RewardedAd.createForAdRequest(id) as unknown as RewardedLike;
    created.addAdEventListener('loaded', () => {
      ready = true;
    });
    // The only place the reward is granted. Not on close, which would pay
    // somebody who dismissed it, and not on any click-derived event.
    created.addAdEventListener('earned_reward', () => {
      grantAdFree();
    });
    created.addAdEventListener('closed', () => {
      ready = false;
      created.load();
    });
    created.addAdEventListener('error', () => {
      ready = false;
    });
    ad = created;
    created.load();
  } catch {
    ad = null;
  }
}

/** Whether there is something to offer. The button hides itself when false —
 *  an offer that does nothing when pressed is worse than no offer. */
export function isRewardedReady(): boolean {
  return ad !== null && ready;
}

/**
 * Plays it. Resolves when the ad closes, whether or not a reward was earned —
 * the grant happens on its own event, so the caller does not have to interpret
 * anything.
 */
export async function showRewarded(): Promise<void> {
  if (ad === null || !ready) return;
  try {
    await ad.show();
  } catch {
    // Nothing to do. No reward is granted on this path, which is the correct
    // outcome for an ad that never played.
  }
}
