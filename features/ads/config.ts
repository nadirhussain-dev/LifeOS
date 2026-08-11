/**
 * Ad placements — real Google Mobile Ads SDK, Google's own TEST ad units.
 *
 * Free accounts see a small, fixed number of ads; a Plus subscription
 * removes them (`usePlan().isPlus`, same flag every other Plus feature this
 * session gates on). `AdSlot` (./components/ad-slot.tsx) renders a real
 * `<BannerAd unitId={TestIds.BANNER} />` — Google's official, platform-aware
 * test unit, self-labeled "Test Ad" by the SDK itself, never real inventory
 * and never real revenue. The SDK is initialized once at startup
 * (`lib/ads-init.ts`) and configured via the `react-native-google-mobile-ads`
 * plugin in `app.json`, currently pointed at Google's universal TEST App
 * IDs — see that plugin entry's own comment.
 *
 * The one thing left before a store release is swapping two things, both
 * documented at their own call sites:
 *  1. the test App IDs in `app.json`'s plugin config → your real AdMob
 *     App IDs (one per platform),
 *  2. `TestIds.BANNER` in `ad-slot.tsx` → your real per-placement ad unit
 *     id(s) from the AdMob console.
 * No call site below (`<AdSlot placement="..." />`) changes either way —
 * every screen that wants an ad slot already just names one of these.
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
] as const;

export type AdPlacement = (typeof AD_PLACEMENTS)[number];
