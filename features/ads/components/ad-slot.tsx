import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { BannerAd, BannerAdSize, TestIds } from 'react-native-google-mobile-ads';

import { Text } from '@/components/ui/text';
import { useAuthStore } from '@/features/auth/services/auth-store';
import { usePlan } from '@/features/billing/hooks/use-billing';
import { useBillingStore } from '@/features/billing/store/billing-store';
import type { AdPlacement } from '@/features/ads/config';
import { useTheme } from '@/hooks/use-theme';

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
 * Renders nothing for a Plus account, nothing before a signed-in account's
 * plan cache has been checked once (never flash an ad at a paying
 * subscriber while `useBillingSync`'s first round trip is in flight), and
 * nothing if the ad itself fails to load (a dev environment without the
 * native module, or no network) — never an empty grey box.
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

  if (isPlus || failed) return null;
  if (session && checkedAt === null) return null;

  return (
    <View className="items-center gap-2" testID={`ad-slot-${placement}`}>
      <Text variant="micro">{t('ads.eyebrow')}</Text>
      <BannerAd
        unitId={TestIds.BANNER}
        size={BannerAdSize.BANNER}
        onAdFailedToLoad={() => setFailed(true)}
      />
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push('/settings/media')}
        hitSlop={8}
      >
        <Text variant="caption" className="font-sora-semibold" style={{ color: c.accent }}>
          {t('ads.removeWithPlus')}
        </Text>
      </Pressable>
    </View>
  );
}
