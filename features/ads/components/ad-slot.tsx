import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, View } from 'react-native';
import type * as GoogleMobileAdsModule from 'react-native-google-mobile-ads';

import { Text } from '@/components/ui/text';
import { useAuthStore } from '@/features/auth/services/auth-store';
import { usePlan } from '@/features/billing/hooks/use-billing';
import { useBillingStore } from '@/features/billing/store/billing-store';
import { ADS_MODULE_ID, type AdPlacement } from '@/features/ads/config';
import { useModuleFlagsStore } from '@/features/module-flags/store/module-flags-store';
import { useTheme } from '@/hooks/use-theme';
import { env } from '@/lib/env';

type Props = { placement: AdPlacement };

// Loaded lazily via `require()`, guarded by try/catch, rather than a static
// ES `import` at the top of this file — a static import is evaluated (and
// can throw) the instant anything imports this file, which would crash the
// whole app rather than just this ad slot. That's not hypothetical: a still
// -open upstream bug (the JS spec calls `TurboModuleRegistry.getEnforcing`,
// but the Android native module is a legacy bridge module, not a real
// TurboModule) throws on New Architecture today —
// https://github.com/invertase/react-native-google-mobile-ads/issues/676
// Resolved once, cached, so every AdSlot instance shares one outcome.
let adsModule: typeof GoogleMobileAdsModule | null | undefined;
function loadAdsModule(): typeof GoogleMobileAdsModule | null {
  if (adsModule === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      adsModule = require('react-native-google-mobile-ads');
    } catch {
      adsModule = null;
    }
  }
  // TS can't carry the narrowing on a module-scope `let` across the
  // try/catch above out to here, even though both branches always leave it
  // `typeof GoogleMobileAdsModule | null` — never `undefined` — by the time
  // execution reaches this line. `?? null` says so explicitly instead of
  // widening the return type to admit a value this function never returns.
  return adsModule ?? null;
}

/**
 * One ad slot — see config.ts for the placement list, the "never in
 * `/private/*`" rule this relies on every call site respecting, and the
 * real-SDK swap-in this file IS: `TestIds.BANNER` is Google's official,
 * platform-aware test unit id — always serves a real ad creative
 * self-labeled "Test Ad" by Google's own SDK, never real inventory, safe to
 * ship in a dev build. Swapping to a real per-placement ad unit id (from
 * your own AdMob console) is the one line left before a store release —
 * everything else here (initialization, layout, the Plus gate) doesn't
 * change.
 *
 * Renders nothing for a Plus account, nothing before a signed-in account's
 * plan cache has been checked once (never flash an ad at a paying
 * subscriber while `useBillingSync`'s first round trip is in flight), and
 * nothing if the ad itself fails to load (a dev environment without the
 * native module, or no network) — never an empty grey box.
 *
 * "Fails to load" was too narrow a condition for that promise. A banner that
 * is still fetching — or that quietly never fills without ever calling
 * `onAdFailedToLoad` — renders at zero height, which left the "AD" eyebrow and
 * the "Remove ads with Plus" link framing a labelled hole in the middle of the
 * screen. So the chrome waits for `onAdLoaded`: until an ad is actually on
 * screen there is nothing to label and nothing to offer removing. The banner
 * itself stays mounted throughout, because unmounting it is what would stop it
 * ever loading.
 *
 * The unit id is env-driven per platform (EXPO_PUBLIC_ADMOB_BANNER_UNIT_ID_
 * ANDROID/IOS, see lib/env.ts) and falls back to `TestIds.BANNER` — Google's
 * official, platform-aware test unit — when unset, so a build with no AdMob
 * config still runs and still shows a real (test) ad rather than nothing.
 *
 * The "remove ads" link is deliberately its OWN pressable, below the banner
 * with real spacing, never wrapping or overlapping the ad creative itself —
 * stacking app UI on top of an ad (or making app UI behave like part of the
 * ad) is exactly what ad-network policies exist to prevent.
 */
export function AdSlot({ placement }: Props) {
  const router = useRouter();
  const { t } = useTranslation();
  const { c } = useTheme();
  const session = useAuthStore((s) => s.session);
  const { isPlus } = usePlan();
  const checkedAt = useBillingStore((s) => s.checkedAt);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  // The operator's global kill switch (app/settings/operator.tsx's Ads
  // toggle) — same remote flag system as every Hub module, absence-means-on
  // so a network blip never strips ads *back in* for someone who turned
  // their limited data on to avoid them.
  const adsEnabled = useModuleFlagsStore((s) => s.flags[ADS_MODULE_ID]?.enabled !== false);

  const mod = loadAdsModule();

  if (isPlus || failed || !mod || !adsEnabled) return null;
  if (session && checkedAt === null) return null;

  const { BannerAd, BannerAdSize, TestIds } = mod;
  const realUnitId =
    Platform.OS === 'ios'
      ? env.EXPO_PUBLIC_ADMOB_BANNER_UNIT_ID_IOS
      : env.EXPO_PUBLIC_ADMOB_BANNER_UNIT_ID_ANDROID;

  return (
    // No gap until the banner has height, or the two invisible children would
    // space themselves apart and reintroduce the hole this closes.
    <View
      className="items-center"
      style={loaded ? { gap: 8 } : undefined}
      testID={`ad-slot-${placement}`}
    >
      {loaded && <Text variant="micro">{t('ads.eyebrow')}</Text>}
      <BannerAd
        unitId={realUnitId || TestIds.BANNER}
        size={BannerAdSize.BANNER}
        onAdLoaded={() => setLoaded(true)}
        onAdFailedToLoad={() => setFailed(true)}
      />
      {loaded && (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/settings/media')}
          hitSlop={8}
        >
          <Text variant="caption" className="font-sora-semibold" style={{ color: c.accent }}>
            {t('ads.removeWithPlus')}
          </Text>
        </Pressable>
      )}
    </View>
  );
}
