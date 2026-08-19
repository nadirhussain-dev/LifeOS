import { Platform } from 'react-native';

import { loadAdsModule } from '@/features/ads/services/ads-module';
import { useAdsConsentStore } from '@/features/ads/store/ads-consent-store';

/**
 * Consent, gathered before the first ad request of every launch.
 *
 * Two separate permissions, often confused, both required to serve
 * *personalised* ads and neither one sufficient alone:
 *
 *  1. **UMP / GDPR** (both platforms). Google's User Messaging Platform
 *     renders the consent form; the messages themselves are authored in the
 *     AdMob console under Privacy & messaging, not here. Without a published
 *     GDPR message, `isConsentFormAvailable` is false in the EEA/UK and
 *     `canRequestAds` stays false — which is a console task, not a bug in
 *     this file, and the reason the operator has to finish that setup before
 *     European traffic earns anything.
 *  2. **ATT** (iOS only). Apple's tracking prompt, gating the IDFA. Denying
 *     it does not stop ads — it drops them to non-personalised, at a
 *     materially lower eCPM.
 *
 * Order matters and is the order Google documents: UMP first, ATT second.
 * The UMP form is where a publisher is allowed to explain *why* the iOS
 * prompt is about to appear, and an ATT prompt fired before that explanation
 * is the one users reflexively deny.
 *
 * Nothing here throws. Every failure path — no native module, no network, a
 * form the user swiped away — lands on `canRequestAds: false`, which shows no
 * ads rather than showing unconsented ones.
 */

/** Returned to `initAds()` so it only initialises the SDK once consent allows
 *  an ad request. */
export type AdsConsentOutcome = { canRequestAds: boolean };

/**
 * iOS's App Tracking Transparency prompt.
 *
 * Lazily required for the same reason the ads SDK is: a runtime without the
 * native module (Expo Go, web, jest) must degrade to "no tracking permission"
 * rather than take the caller down with it.
 *
 * `isAvailable()` is false on Android and on iOS below 14, where there is no
 * prompt to show and `requestTrackingPermissionsAsync()` has nothing to
 * resolve — checking it is what keeps this a no-op on Android rather than a
 * caught exception on every Android launch.
 */
async function requestTrackingPermission(): Promise<void> {
  if (Platform.OS !== 'ios') return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const tracking = require('expo-tracking-transparency');
    if (!tracking.isAvailable()) return;
    // Resolves with the existing status without re-prompting when the user
    // has already answered — iOS only ever shows this prompt once per
    // install, so there is no "ask again" to guard against here.
    await tracking.requestTrackingPermissionsAsync();
  } catch {
    // No ATT module in this runtime. Ads still serve, non-personalised.
  }
}

/**
 * Runs the full consent flow and publishes the result to
 * `useAdsConsentStore`. Safe to call more than once; the UMP SDK treats a
 * repeat `gatherConsent()` as a cheap status re-read once a form has been
 * answered.
 */
export async function gatherAdsConsent(): Promise<AdsConsentOutcome> {
  const mod = loadAdsModule();
  if (!mod) {
    // No native module at all. Mark the flow resolved so `AdSlot` stops
    // waiting on an answer that is never coming — it renders nothing either
    // way, but "resolved and not allowed" is the honest state.
    useAdsConsentStore.getState().set({ resolved: true, canRequestAds: false });
    return { canRequestAds: false };
  }

  try {
    // requestInfoUpdate + show the form if one is required, in one call.
    const info = await mod.AdsConsent.gatherConsent();

    await requestTrackingPermission();

    useAdsConsentStore.getState().set({
      canRequestAds: info.canRequestAds,
      privacyOptionsRequired:
        info.privacyOptionsRequirementStatus ===
        mod.AdsConsentPrivacyOptionsRequirementStatus.REQUIRED,
      resolved: true,
    });
    return { canRequestAds: info.canRequestAds };
  } catch {
    // A form that failed to load, or no network on a cold start in the EEA.
    // Serve nothing this launch rather than serving without consent; the next
    // launch retries.
    useAdsConsentStore.getState().set({ resolved: true, canRequestAds: false });
    return { canRequestAds: false };
  }
}

/**
 * Reopens the consent form from Settings, so a user can change their mind
 * after the one-time prompt — required by the UMP policy this implements, and
 * the reason `privacyOptionsRequired` is tracked at all.
 *
 * Returns false when the form could not be shown, so the caller can say so
 * instead of leaving a tapped row looking broken.
 */
export async function showAdPrivacyOptions(): Promise<boolean> {
  const mod = loadAdsModule();
  if (!mod) return false;
  try {
    const info = await mod.AdsConsent.showPrivacyOptionsForm();
    // The user may have just withdrawn consent, which revokes our right to
    // request ads mid-session — reflect it now rather than at next launch.
    useAdsConsentStore.getState().set({
      canRequestAds: info.canRequestAds,
      privacyOptionsRequired:
        info.privacyOptionsRequirementStatus ===
        mod.AdsConsentPrivacyOptionsRequirementStatus.REQUIRED,
    });
    return true;
  } catch {
    return false;
  }
}
