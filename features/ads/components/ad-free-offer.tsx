import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { cardClass } from '@/components/ui/card';
import { PlayCircle } from '@/components/ui/icons';
import { Text } from '@/components/ui/text';
import { isRewardedReady, preloadRewarded, showRewarded } from '@/features/ads/services/rewarded';
import { useAdFreeStore } from '@/features/ads/store/ad-free-store';
import { useAdsConsentStore } from '@/features/ads/store/ads-consent-store';
import { useEntitlement } from '@/features/billing/hooks/use-billing';
import { useTheme } from '@/hooks/use-theme';
import { alpha } from '@/lib/color';

/**
 * "Watch an ad, get a day without ads."
 *
 * The one place a rewarded ad is offered, and everything about its shape is a
 * policy requirement rather than a style choice:
 *
 *  - **It is a button somebody presses.** A rewarded ad may never be triggered
 *    by navigation or a timer. Nothing else in the app calls `showRewarded`.
 *  - **The reward is named before the ad, not after.** The label says what it
 *    buys; there is nothing to explain afterwards.
 *  - **It disappears when there is nothing to offer** — no consent, no loaded
 *    ad, or a window already running. An offer that does nothing when pressed
 *    is worse than no offer, and one shown to somebody who is already ad-free
 *    is an ad request that buys them nothing.
 *
 * It lives in Settings rather than beside a banner deliberately. Stacking a
 * second interactive control next to an ad creative — or anywhere it could be
 * mistaken for part of one — is exactly what the placement policies exist to
 * prevent, and the "remove ads with Plus" link already routes people here.
 *
 * Nothing is offered to somebody whose tier has ads switched off: they have
 * already paid for the thing this is selling.
 */
export function AdFreeOffer() {
  const { t } = useTranslation();
  const { c } = useTheme();
  const showAds = useEntitlement('ads');
  const canRequestAds = useAdsConsentStore((s) => s.canRequestAds);
  const until = useAdFreeStore((s) => s.until);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);

  const adFree = until !== null && until > Date.now();

  useEffect(() => {
    if (!showAds || !canRequestAds || adFree) return;
    preloadRewarded();
    // Polled rather than subscribed, because the SDK's readiness is not a
    // store — a second or two of "not yet" on a settings screen nobody is
    // waiting on is a much smaller cost than an event bridge for one caller.
    const timer = setInterval(() => setReady(isRewardedReady()), 1000);
    setReady(isRewardedReady());
    return () => clearInterval(timer);
  }, [showAds, canRequestAds, adFree]);

  if (!showAds || !canRequestAds) return null;

  if (adFree) {
    const hoursLeft = Math.max(1, Math.ceil((until - Date.now()) / (60 * 60 * 1000)));
    return (
      <View className={cardClass({ padding: 'md' }, 'gap-1')}>
        <Text className="font-sora-semibold">{t('ads.adFreeActive')}</Text>
        <Text variant="caption">{t('ads.adFreeRemaining', { count: hoursLeft })}</Text>
      </View>
    );
  }

  if (!ready) return null;

  return (
    <Pressable
      accessibilityRole="button"
      disabled={busy}
      onPress={() => {
        setBusy(true);
        void showRewarded().finally(() => setBusy(false));
      }}
      className={cardClass({ padding: 'md' }, 'flex-row items-center gap-3')}
    >
      <View
        className="h-9 w-9 items-center justify-center rounded-xl"
        style={{ backgroundColor: alpha(c.accent, 0.14) }}
      >
        <PlayCircle size={18} color={c.accent} strokeWidth={2} />
      </View>
      <View className="flex-1 gap-0.5">
        <Text className="font-sora-semibold">{t('ads.watchForAdFree')}</Text>
        <Text variant="caption">{t('ads.watchForAdFreeHint')}</Text>
      </View>
    </Pressable>
  );
}
