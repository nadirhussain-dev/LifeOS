import { AD_MAX_CONTENT_RATING } from '@/features/ads/config';
import { loadAdsModule } from '@/features/ads/services/ads-module';
import { gatherAdsConsent } from '@/features/ads/services/consent';

let initialized = false;

/**
 * Prepares the Google Mobile Ads SDK once at startup — same shape as
 * `initAds()`: a single idempotent call, tolerant of
 * failure, made once from app/_layout.tsx rather than lazily from whichever
 * screen happens to mount an `AdSlot` first.
 *
 * Three steps, in an order the SDK requires:
 *
 *   1. `setRequestConfiguration` — must land *before* `initialize()`, or the
 *      first ad request of the session goes out under the SDK's defaults
 *      (which include `MA`-rated inventory; see AD_MAX_CONTENT_RATING).
 *   2. Consent (features/ads/services/consent.ts) — UMP, then ATT on iOS.
 *   3. `initialize()`, only if consent came back allowing ad requests.
 *
 * Stopping at step 3 when `canRequestAds` is false is the point of the whole
 * sequence: an uninitialised SDK makes no ad request, which is what "no
 * consent" has to mean in practice. `AdSlot` independently refuses to render
 * until the store says otherwise, so this is a belt-and-braces pair rather
 * than one gate doing all the work.
 *
 * Synchronous and `void`-returning despite the async work inside, because the
 * one call site runs at module scope during boot and must not be blocked by a
 * consent form. Nothing awaits the outcome; the store publishes it instead.
 *
 * Native module: this only does anything in a dev-client/EAS build, never
 * Expo Go — same constraint every other native plugin in app.json already
 * carries (the Android widgets, Face ID). See
 * `loadAdsModule()` for why the import is a lazy, caught `require()` rather
 * than a static ES `import` that would throw at boot.
 */
export function initAds(): void {
  if (initialized) return;
  initialized = true;

  void (async () => {
    try {
      const mod = loadAdsModule();
      if (!mod) return;

      await mod.default().setRequestConfiguration({
        maxAdContentRating: mod.MaxAdContentRating[AD_MAX_CONTENT_RATING],
        // Daykeep is not a children's app and does not claim to be one.
        // Both flags are stated explicitly rather than left undefined,
        // because "we did not think about COPPA" and "we considered it and
        // this app is not child-directed" are the same value to the SDK and
        // very different things to be able to point at later.
        tagForChildDirectedTreatment: false,
        tagForUnderAgeOfConsent: false,
      });

      const { canRequestAds } = await gatherAdsConsent();
      if (!canRequestAds) return;

      await mod.default().initialize();
    } catch {
      // No usable native module in this runtime, or a consent/init call that
      // failed. `AdSlot`'s own guards handle the per-screen fallback; this
      // just stops any of it taking the app down at startup.
    }
  })();
}
