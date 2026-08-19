import type * as GoogleMobileAdsModule from 'react-native-google-mobile-ads';

/**
 * The one place `react-native-google-mobile-ads` is pulled into the bundle.
 *
 * Loaded lazily via `require()`, guarded by try/catch, rather than a static
 * ES `import` — a static import is evaluated (and can throw) the instant
 * anything imports the file holding it, which would crash the whole app
 * rather than just disabling ads. That is not hypothetical: a still-open
 * upstream bug (the JS spec calls `TurboModuleRegistry.getEnforcing`, but the
 * Android native module is a legacy bridge module, not a real TurboModule)
 * throws on New Architecture today —
 * https://github.com/invertase/react-native-google-mobile-ads/issues/676
 *
 * It also returns `null` in any runtime with no native module at all (Expo
 * Go, web, jest), which every caller already has to handle for that reason.
 *
 * Resolved once and cached, so every caller — `initAds()`, the consent flow,
 * and each mounted `AdSlot` — shares one outcome instead of each re-entering
 * a `require()` that has already been proven to throw.
 */
let adsModule: typeof GoogleMobileAdsModule | null | undefined;

export function loadAdsModule(): typeof GoogleMobileAdsModule | null {
  if (adsModule === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      adsModule = require('react-native-google-mobile-ads');
    } catch {
      adsModule = null;
    }
  }
  // TS can't carry the narrowing on a module-scope `let` across the try/catch
  // above out to here, even though both branches always leave it
  // `typeof GoogleMobileAdsModule | null` — never `undefined` — by the time
  // execution reaches this line. `?? null` says so explicitly instead of
  // widening the return type to admit a value this function never returns.
  return adsModule ?? null;
}
