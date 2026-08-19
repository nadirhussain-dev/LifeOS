import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { useAuthStore } from '@/features/auth/services/auth-store';
import { useEntitlement } from '@/features/billing/hooks/use-billing';
import { useBillingStore } from '@/features/billing/store/billing-store';
import { ADS_MODULE_ID, type AdPlacement } from '@/features/ads/config';
import { loadAdsModule } from '@/features/ads/services/ads-module';
import { useAdsConsentStore } from '@/features/ads/store/ads-consent-store';
import { useModuleFlagsStore } from '@/features/module-flags/store/module-flags-store';
import { useTheme } from '@/hooks/use-theme';
import { env } from '@/lib/env';

type Props = { placement: AdPlacement };

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
 * Renders nothing for a tier whose `ads` entitlement is off, nothing until
 * the UMP consent flow has
 * granted `canRequestAds` (see features/ads/services/consent.ts — an EEA user
 * who declines never has an ad requested for them at all), nothing before a
 * signed-in account's plan cache has been checked once (never flash an ad at
 * a paying subscriber while `useBillingSync`'s first round trip is in
 * flight), and nothing if the ad itself fails to load (a dev environment
 * without the native module, or no network) — never an empty grey box.
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
  // The entitlement, not `isPlus`. `plan_entitlements.ads` (0059) is the
  // operator-editable answer to "does this tier see ads", and reading the tier
  // ladder instead left that column doing nothing: turning ads off for the
  // standard tier changed no behaviour anywhere. Named for what it grants —
  // true means ads are shown — so the row reads the same way in the table.
  //
  // Its fallback is the freemium row (`ENTITLEMENT_DEFAULTS`), so a cache miss
  // shows an ad to somebody who may have paid. That is the deliberate direction:
  // the correction is one refresh away, whereas defaulting the other way hands
  // out a paid capability to anyone whose network dropped.
  const showAds = useEntitlement('ads');
  const checkedAt = useBillingStore((s) => s.checkedAt);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  // The operator's global kill switch (app/settings/operator.tsx's Ads
  // toggle) — same remote flag system as every Hub module, absence-means-on
  // so a network blip never strips ads *back in* for someone who turned
  // their limited data on to avoid them.
  const adsEnabled = useModuleFlagsStore((s) => s.flags[ADS_MODULE_ID]?.enabled !== false);
  // Consent (features/ads/services/consent.ts). False until UMP has answered
  // this launch, so the very first render of a cold start cannot put an ad
  // request on the wire ahead of the consent form.
  const canRequestAds = useAdsConsentStore((s) => s.canRequestAds);

  const mod = loadAdsModule();

  if (!showAds || failed || !mod || !adsEnabled || !canRequestAds) return null;
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
        // Anchored adaptive, not the fixed 320x50 `BANNER`. It fills the
        // device width and picks its own height, which is the format Google
        // optimises fill and price for — the fixed unit leaves both on the
        // table on every screen wider than a 2016 phone. The `loaded` gate
        // below already handles the variable height: nothing is drawn around
        // the banner until it reports a real ad on screen.
        size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
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
