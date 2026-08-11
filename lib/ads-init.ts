let initialized = false;

/**
 * Initializes the Google Mobile Ads SDK once at startup — same shape as
 * `initSentry()` (lib/sentry.ts): a single idempotent call, tolerant of
 * failure, made once from app/_layout.tsx rather than lazily from whichever
 * screen happens to mount an `AdSlot` first.
 *
 * Native module: this only does anything in a dev-client/EAS build, never
 * Expo Go — same constraint every other native plugin in app.json already
 * carries (the Android widgets, Face ID, Sentry's native layer). The import
 * is deliberately a lazy `require()` inside the try/catch rather than a
 * static ES `import` at the top of the file: a static import is evaluated
 * (and can throw) before this function's own try/catch ever runs, which
 * would crash the whole app at boot instead of just skipping ads. This
 * matters concretely today — a still-open upstream bug in
 * react-native-google-mobile-ads (its JS spec calls
 * `TurboModuleRegistry.getEnforcing`, but the Android native module is a
 * legacy bridge module, not a real TurboModule) throws on New Architecture:
 * https://github.com/invertase/react-native-google-mobile-ads/issues/676
 */
export function initAds(): void {
  if (initialized) return;
  initialized = true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mobileAds = require('react-native-google-mobile-ads').default;
    void mobileAds()
      .initialize()
      .catch(() => undefined);
  } catch {
    // No usable native module in this runtime — AdSlot's own lazy loader
    // handles the per-screen fallback; this just stops it taking the app
    // down at startup.
  }
}
