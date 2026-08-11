import { useRouter } from 'expo-router';
import { Megaphone } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { useAuthStore } from '@/features/auth/services/auth-store';
import { usePlan } from '@/features/billing/hooks/use-billing';
import { useBillingStore } from '@/features/billing/store/billing-store';
import type { AdPlacement } from '@/features/ads/config';
import { useTheme } from '@/hooks/use-theme';
import { alpha } from '@/lib/color';

type Props = { placement: AdPlacement };

/**
 * One ad slot — see config.ts for the mock/real split and the "never in
 * `/private/*`" rule this relies on every call site respecting.
 *
 * Renders nothing for a Plus account. A guest (no session) is unambiguously
 * free — nothing to wait on — but a *signed-in* account waits for the plan
 * cache's first check (`checkedAt === null`) before rendering anything, so
 * a returning Plus subscriber never sees this flash on screen while
 * `useBillingSync`'s first round trip is still in flight.
 */
export function AdSlot({ placement }: Props) {
  const router = useRouter();
  const { t } = useTranslation();
  const { c } = useTheme();
  const session = useAuthStore((s) => s.session);
  const { isPlus } = usePlan();
  const checkedAt = useBillingStore((s) => s.checkedAt);

  if (isPlus) return null;
  if (session && checkedAt === null) return null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('ads.placeholderLabel')}
      onPress={() => router.push('/settings/media')}
      className="items-center gap-1.5 rounded-2xl border border-dashed px-4 py-5"
      style={{ borderColor: c.border, backgroundColor: alpha(c.mutedForeground, 0.05) }}
      testID={`ad-slot-${placement}`}
    >
      <View className="flex-row items-center gap-1.5">
        <Megaphone size={13} color={c.mutedForeground} />
        <Text variant="micro">{t('ads.eyebrow')}</Text>
      </View>
      <Text variant="caption" className="text-center">
        {t('ads.placeholderBody')}
      </Text>
      <Text variant="caption" className="font-sora-semibold" style={{ color: c.accent }}>
        {t('ads.removeWithPlus')}
      </Text>
    </Pressable>
  );
}
