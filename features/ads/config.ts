import type { MaxAdContentRating } from 'react-native-google-mobile-ads';

/**
 * Ad placements — real Google Mobile Ads SDK, Google's own TEST ad units.
 *
 * Free accounts see a small, fixed number of ads; a Plus subscription
 * removes them (`usePlan().isPlus`, same flag every other Plus feature this
 * session gates on). `AdSlot` (./components/ad-slot.tsx) renders a real
 * `<BannerAd>`, defaulting to Google's official, platform-aware test unit —
 * self-labeled "Test Ad" by the SDK itself, never real inventory and never
 * real revenue — until real ids are configured. The SDK is initialized once
 * at startup (`lib/ads-init.ts`).
 *
 * Everything AdMob-specific is env-driven, not hardcoded, so going live is a
 * config change rather than a code change:
 *  1. `ADMOB_ANDROID_APP_ID`/`ADMOB_IOS_APP_ID` (build-time, no
 *     `EXPO_PUBLIC_` prefix — see app.config.js) override the test App IDs
 *     the `react-native-google-mobile-ads` plugin in `app.json` ships with.
 *  2. `EXPO_PUBLIC_ADMOB_BANNER_UNIT_ID_ANDROID`/`_IOS` (see lib/env.ts)
 *     override `TestIds.BANNER` in `ad-slot.tsx`.
 * Unset on either side keeps the test defaults — a build with none of these
 * set still runs and still shows real (test) ad UI. Set them once via
 * `eas env:set` per environment and rebuild; no call site below
 * (`<AdSlot placement="..." />`) changes either way.
 *
 * Never placed inside `/private/*`. That surface holds cycle, recovery,
 * intimacy and vault data; an ad SDK has no business anywhere near it, full
 * stop. Enforced by convention (every call site lives on an ordinary tab
 * screen — Hub, Gallery, Tasks, Habits — none of them under `/private/*`)
 * rather than a runtime route check, because the honest fix for "don't put
 * ads in the private space" is to never write the call site, not to add a
 * guard a future edit could route around.
 */
export const AD_PLACEMENTS = [
  'hub-bottom',
  'gallery-bottom',
  'tasks-bottom',
  'habits-bottom',
  'journal-bottom',
  'notes-bottom',
  'goals-bottom',
  'budget-bottom',
] as const;

export type AdPlacement = (typeof AD_PLACEMENTS)[number];

/**
 * The id `AdSlot` is gated under in the remote module-flags system
 * (supabase/migrations/0011_module_flags.sql) — lets the operator turn ads
 * off for every free account without an app-store round trip, the same
 * lever every Hub module already has. Not a real Hub module (nobody
 * navigates to an "Ads" screen), but `module_flags.module` is untyped text
 * on purpose specifically so a new switch never needs a migration — see that
 * file's own comment. The operator console's Ads toggle
 * (app/settings/operator.tsx) and this file are the only two call sites;
 * kept as a constant so they can't drift into two different strings.
 */
export const ADS_MODULE_ID = 'ads';

/**
 * The strongest content rating an ad is allowed to carry, applied globally in
 * `initAds()` before the SDK is initialised.
 *
 * `T` ("Teen"), not the `MA` the SDK defaults to when unset. `MA` admits
 * gambling, alcohol and sexual content, and the surfaces ads actually appear
 * on include Budget and Habits — a debt tracker serving betting ads to
 * someone reading their own overdraft is the single most obviously wrong ad
 * this app could show, whatever it pays. `T` still allows the health,
 * fitness and finance advertisers that fit these screens.
 *
 * Not env-driven, deliberately: unlike the ad unit ids, this is a product
 * decision that should not differ between a staging build and a store build.
 */
export const AD_MAX_CONTENT_RATING: keyof typeof MaxAdContentRating = 'T';
