/**
 * Ad placements — mocked, for now.
 *
 * Free accounts see a small, fixed number of ads; a Plus subscription
 * removes them (`usePlan().isPlus`, same flag every other Plus feature this
 * session gates on). Nothing here talks to an ad network: `AdSlot`
 * (./components/ad-slot.tsx) renders a clearly-labeled placeholder card,
 * the same "mock describes the payment/behaviour, not the enforcement"
 * discipline `billing-store.ts` already documents for the plan itself.
 *
 * The real-SDK swap-in later is meant to be exactly one seam:
 *  1. `npx expo install react-native-google-mobile-ads`
 *  2. add its config plugin to `app.json` (`expo-build-properties` +
 *     the AdMob plugin — this requires a custom dev client / EAS build,
 *     Expo Go cannot load native ad SDKs)
 *  3. set real `EXPO_PUBLIC_ADMOB_APP_ID_(IOS|ANDROID)` and per-placement
 *     ad-unit IDs (mirroring `lib/env.ts`'s existing pattern)
 *  4. replace `AdSlot`'s placeholder body with `<BannerAd unitId={...} />`
 * No call site below (`<AdSlot placement="..." />`) changes when that
 * happens — every screen that wants an ad slot already names one of these.
 *
 * Never placed inside `/private/*`. That surface holds cycle, recovery,
 * intimacy and vault data; an ad SDK — even this mock, which is explicitly
 * a preview of where a real one would eventually sit — has no business
 * anywhere near it, full stop. Enforced by convention (every call site below
 * lives on an ordinary tab screen — Hub, Gallery, Tasks, Habits — none of
 * them under `/private/*`) rather than a runtime route check, because the
 * honest fix for "don't put ads in the private space" is to never write the
 * call site, not to add a guard a future edit could route around.
 */
export const AD_PLACEMENTS = [
  'hub-bottom',
  'gallery-bottom',
  'tasks-bottom',
  'habits-bottom',
] as const;

export type AdPlacement = (typeof AD_PLACEMENTS)[number];
