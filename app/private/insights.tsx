import { useRouter } from 'expo-router';
import { Lock, Sparkles, TrendingDown, TrendingUp } from 'lucide-react-native';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { cardClass } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { moduleTints, resolveTint } from '@/constants/design-tokens';
import { colors } from '@/constants/theme';
import { usePlan } from '@/features/billing/hooks/use-billing';
import { PrivateScreen } from '@/features/private/components/private-screen';
import { listCycleEntries } from '@/features/private/services/cycle';
import { periodsFrom } from '@/features/private/services/cycle-math';
import {
  cycleLengthTrend,
  intimacyMoodTrend,
  recoverySummary,
} from '@/features/private/services/insights';
import { listIntimacyEntries } from '@/features/private/services/intimacy';
import { listRecoveryEntries } from '@/features/private/services/recovery';
import { usePrivateStore } from '@/features/private/store/private-store';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { alpha } from '@/lib/color';

/**
 * The Insights screen: trends over data every free account already logs.
 * Gated on the plan client-side only, deliberately — there is nothing to
 * enforce server-side here the way shared-album scale needs 0032's
 * triggers, because reading your own already-synced rows costs nothing and
 * a UI gate is the entire mechanism (same as the mock storage plan cards).
 */
export default function InsightsScreen() {
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const theme = colors[scheme];
  const { t } = useTranslation();
  const { isPlus } = usePlan();
  const enabled = usePrivateStore((s) => s.enabledModules);

  const cycleTint = resolveTint(moduleTints.cycle, scheme);
  const recoveryTint = resolveTint(moduleTints.recovery, scheme);
  const intimacyTint = resolveTint(moduleTints.intimacy, scheme);

  const cycleTrend = useMemo(() => {
    if (!enabled.includes('cycle')) return null;
    return cycleLengthTrend(periodsFrom(listCycleEntries()));
  }, [enabled]);

  const recoveryRows = useMemo(() => {
    if (!enabled.includes('recovery')) return null;
    return recoverySummary(listRecoveryEntries());
  }, [enabled]);

  const moodTrend = useMemo(() => {
    if (!enabled.includes('intimacy')) return null;
    return intimacyMoodTrend(listIntimacyEntries());
  }, [enabled]);

  if (!isPlus) {
    return (
      <PrivateScreen title={t('private.insightsTitle')} tint={theme.accent}>
        <View className="items-center gap-4 py-10">
          <View
            className="h-16 w-16 items-center justify-center rounded-3xl"
            style={{ backgroundColor: alpha(theme.accent, 0.14) }}
          >
            <Lock size={26} color={theme.accent} strokeWidth={1.8} />
          </View>
          <View className="items-center gap-1.5 px-6">
            <Text variant="subheading" className="text-center">
              {t('billing.insightsUpsellTitle')}
            </Text>
            <Text variant="muted" className="text-center">
              {t('billing.insightsUpsellBody')}
            </Text>
          </View>
          <Button
            label={t('billing.seePlans')}
            onPress={() => router.push('/settings/media')}
            variant="accent"
          />
        </View>
      </PrivateScreen>
    );
  }

  const nothingToShow =
    !cycleTrend?.length && !recoveryRows?.length && moodTrend?.recentAverage == null;

  return (
    <PrivateScreen
      title={t('private.insightsTitle')}
      subtitle={t('private.insightsSubtitle')}
      tint={theme.accent}
    >
      {nothingToShow ? (
        <View className="items-center gap-2 py-16">
          <Sparkles size={24} color={alpha(theme.accent, 0.6)} />
          <Text variant="muted" className="text-center">
            {t('private.insightsEmpty')}
          </Text>
        </View>
      ) : null}

      {cycleTrend && cycleTrend.length > 0 ? (
        <View className={cardClass({ padding: 'rowLg' }, 'gap-3')}>
          <Text variant="micro">{t('private.cycleTrendTitle')}</Text>
          <View className="h-20 flex-row items-end gap-2">
            {cycleTrend.map((len, i) => {
              const min = Math.min(...cycleTrend);
              const max = Math.max(...cycleTrend);
              const range = Math.max(1, max - min);
              const height = 16 + ((len - min) / range) * 56;
              return (
                <View key={i} className="flex-1 items-center gap-1">
                  <View
                    className="w-full rounded-t-md"
                    style={{ height, backgroundColor: cycleTint }}
                  />
                  <Text variant="caption">{len}</Text>
                </View>
              );
            })}
          </View>
          <Text variant="caption">{t('private.cycleTrendHint')}</Text>
        </View>
      ) : null}

      {recoveryRows && recoveryRows.length > 0 ? (
        <View className={cardClass({ padding: 'rowLg' }, 'gap-3')}>
          <Text variant="micro">{t('private.recoveryTrendTitle')}</Text>
          {recoveryRows.map((row, index) => (
            <View
              key={row.target}
              className={
                index === 0
                  ? 'flex-row items-center justify-between'
                  : 'flex-row items-center justify-between border-t border-border pt-2'
              }
            >
              <Text className="font-sora-medium text-foreground">
                {t(`private.target_${row.target}`)}
              </Text>
              <View className="flex-row items-center gap-3">
                <Text variant="caption" style={{ color: recoveryTint }}>
                  {row.currentStreak === null
                    ? t('private.noRelapses')
                    : t('private.days', { count: row.currentStreak })}
                </Text>
                <Text variant="caption">
                  {row.resisted}/{row.resisted + row.relapsed}
                </Text>
              </View>
            </View>
          ))}
        </View>
      ) : null}

      {moodTrend && moodTrend.recentAverage !== null ? (
        <View className={cardClass({ padding: 'rowLg' }, 'gap-2')}>
          <Text variant="micro">{t('private.moodTrendTitle')}</Text>
          <View className="flex-row items-center gap-2">
            <Text className="font-sora-extrabold text-2xl" style={{ color: intimacyTint }}>
              {moodTrend.recentAverage.toFixed(1)}
            </Text>
            <Text variant="caption">/5</Text>
            {moodTrend.improving !== null ? (
              moodTrend.improving ? (
                <TrendingUp size={16} color={theme.success} />
              ) : (
                <TrendingDown size={16} color={theme.mutedForeground} />
              )
            ) : null}
          </View>
          <Text variant="caption">
            {moodTrend.improving === null
              ? t('private.moodTrendNeedMore')
              : moodTrend.improving
                ? t('private.moodTrendUp')
                : t('private.moodTrendDown')}
          </Text>
        </View>
      ) : null}
    </PrivateScreen>
  );
}
