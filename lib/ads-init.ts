import mobileAds from 'react-native-google-mobile-ads';

let initialized = false;

/**
 * Initializes the Google Mobile Ads SDK once at startup — same shape as
 * `initSentry()` (lib/sentry.ts): a single idempotent call, tolerant of
 * failure, made once from app/_layout.tsx rather than lazily from whichever
 * screen happens to mount an `AdSlot` first.
 *
 * Native module: this only does anything in a dev-client/EAS build, never
 * Expo Go — same constraint every other native plugin in app.json already
 * carries (the Android widgets, Face ID, Sentry's native layer). The
 * try/catch is what keeps a build that hasn't picked up the native module
 * yet (or is still running in an environment without it) from crashing on
 * boot instead of just not showing ads.
 */
export function initAds(): void {
  if (initialized) return;
  initialized = true;
  try {
    void mobileAds()
      .initialize()
      .catch(() => undefined);
  } catch {
    // No native module in this runtime — AdSlot's own onAdFailedToLoad
    // handles the resulting per-banner failure; this just stops it taking
    // the app down at startup.
  }
}
