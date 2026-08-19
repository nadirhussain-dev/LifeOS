import { Platform } from 'react-native';

import { mayShowAdNow, recordAdShown } from '@/features/ads/services/ad-gate';
import { loadAdsModule } from '@/features/ads/services/ads-module';
import { env } from '@/lib/env';

/**
 * The interstitial: one preloaded ad, shown only at an allowlisted breakpoint.
 *
 * ## Preloaded, because the alternative is worse than no ad
 *
 * An interstitial that is requested at the moment it is wanted takes seconds to
 * fill, and the two available behaviours are both bad: block the user behind a
 * spinner, or show the ad after they have already moved on — which is the
 * "unexpected ad" every placement policy is written about. So one is loaded
 * quietly in the background, and `show()` either has one ready or does nothing
 * at all. Nothing is ever awaited in front of the user.
 *
 * ## Every gate is somewhere else
 *
 * This file decides nothing. Whether an ad may be shown is `mayShowAdNow`
 * (ad-gate.ts), which composes the pure pacing rules with entitlement, consent
 * and the operator's kill switch. Keeping the decision out of here is what
 * stops a future call site quietly acquiring its own idea of when an
 * interstitial is acceptable.
 *
 * ## Why the session slot is spent on `opened`, not on `show()`
 *
 * `show()` can be called on an ad that has silently failed, and a request that
 * never filled has cost the user nothing. Counting it would let a run of
 * unfilled requests use up the session cap and leave the user seeing no ads
 * while the app believes it has shown two.
 */

type AdLike = {
  addAdEventListener: (type: string, handler: () => void) => () => void;
  load: () => void;
  show: () => Promise<void>;
  loaded: boolean;
};

let ad: AdLike | null = null;
let ready = false;

function unitId(): string | null {
  const mod = loadAdsModule();
  if (!mod) return null;
  const real =
    Platform.OS === 'ios'
      ? env.EXPO_PUBLIC_ADMOB_INTERSTITIAL_UNIT_ID_IOS
      : env.EXPO_PUBLIC_ADMOB_INTERSTITIAL_UNIT_ID_ANDROID;
  return real || mod.TestIds.INTERSTITIAL;
}

/**
 * Loads one into the chamber. Idempotent and safe to call on every foreground.
 *
 * Never throws: a runtime with no native module (Expo Go, web, jest) simply has
 * no interstitial, which every caller already handles by getting `false` back
 * from `showInterstitial`.
 */
export function preloadInterstitial(): void {
  if (ad !== null) return;
  const mod = loadAdsModule();
  const id = unitId();
  if (!mod || !id) return;

  try {
    const created = mod.InterstitialAd.createForAdRequest(id) as unknown as AdLike;
    created.addAdEventListener('loaded', () => {
      ready = true;
    });
    // A closed ad is a spent ad. Reloading immediately — rather than at the
    // next breakpoint — is what keeps the second one of a session instant,
    // and the pacing cooldown means there is no hurry about it either way.
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

/**
 * Shows the preloaded interstitial if every gate allows it.
 *
 * Returns whether one was actually shown, so a caller that wants to sequence
 * something after it can tell the difference between "shown" and "skipped" —
 * and so a caller that does not care can ignore it entirely.
 */
export async function showInterstitial(input: {
  segments: string[];
  breakpoint: string;
}): Promise<boolean> {
  if (ad === null || !ready) return false;
  if (!(await mayShowAdNow(input))) return false;

  try {
    await ad.show();
    recordAdShown();
    return true;
  } catch {
    // A show that failed is not an impression and must not spend a slot.
    return false;
  }
}
