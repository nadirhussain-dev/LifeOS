import { format, isToday, parseISO } from 'date-fns';
import { useRouter } from 'expo-router';
import { GlassWater, Settings2 } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';

import { cardClass } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { QueryError } from '@/components/ui/query-error';
import { ScreenHeader } from '@/components/ui/screen-header';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { moduleTint } from '@/constants/design-tokens';
import { colors } from '@/constants/theme';
import { useWaterHistory } from '@/features/water-intake/hooks/use-water-history';
import { useWaterSettingsStore } from '@/features/water-intake/store/water-settings-store';

const HISTORY_DAYS = 14;

export default function WaterHistoryScreen() {
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const waterTint = moduleTint('water', scheme);
  const goalMl = useWaterSettingsStore((state) => state.goalMl);
  const { data: history, isLoading, isError, refetch } = useWaterHistory(HISTORY_DAYS);

  const hasAnyData = history?.some((day) => day.totalMl > 0);

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader
        title={t('water.title')}
        eyebrow={t('water.eyebrow')}
        tint={waterTint}
        actions={[
          {
            icon: Settings2,
            label: t('water.settingsAction'),
            onPress: () => router.push('/water-intake/settings'),
          },
        ]}
      />

      {isError ? (
        <QueryError onRetry={() => refetch()} />
      ) : isLoading || !history ? (
        <View className="gap-2.5 px-5 pt-4">
          <Skeleton className="h-40 w-full rounded-2xl" />
        </View>
      ) : !hasAnyData ? (
        <EmptyState
          icon={GlassWater}
          title={t('water.emptyTitle')}
          description={t('water.emptyBody')}
          tint={waterTint}
        />
      ) : (
        <ScrollView
          contentContainerClassName="gap-6 px-5 pt-4 pb-10"
          showsVerticalScrollIndicator={false}
        >
          <View className={cardClass({ padding: 'md', elevation: 'e1' }, 'gap-3')}>
            <Text variant="caption" className="font-sora-semibold uppercase tracking-wide">
              {t('water.lastNDays', { days: HISTORY_DAYS })}
            </Text>
            <View className="h-32 flex-row items-end gap-1.5">
              {history.map((day) => {
                const ratio = goalMl > 0 ? Math.min(day.totalMl / goalMl, 1) : 0;
                const metGoal = day.totalMl >= goalMl && goalMl > 0;
                return (
                  <View key={day.date} className="flex-1 items-center gap-1">
                    <View className="h-24 w-full justify-end overflow-hidden rounded-sm bg-surface">
                      <View
                        className="w-full rounded-sm"
                        style={{
                          height: `${ratio * 100}%`,
                          backgroundColor: metGoal ? waterTint : `${waterTint}80`,
                        }}
                      />
                    </View>
                    <Text
                      variant="caption"
                      style={
                        isToday(parseISO(day.date))
                          ? { color: colors[scheme].foreground }
                          : undefined
                      }
                    >
                      {format(parseISO(day.date), 'EEEEE')}
                    </Text>
                  </View>
                );
              })}
            </View>
          </View>

          <View className={cardClass({ padding: 'none', elevation: 'e1' }, 'gap-1 px-4')}>
            {[...history].reverse().map((day, index) => (
              <View
                key={day.date}
                className={
                  index === 0
                    ? 'flex-row items-center justify-between py-3'
                    : 'flex-row items-center justify-between border-t border-border py-3'
                }
              >
                <Text variant="muted">{format(parseISO(day.date), 'EEEE, MMM d')}</Text>
                <Text
                  className="font-sora-medium"
                  style={day.totalMl >= goalMl && goalMl > 0 ? { color: waterTint } : undefined}
                >
                  {t('water.milliliters', { amount: day.totalMl })}
                </Text>
              </View>
            ))}
          </View>
        </ScrollView>
      )}
    </View>
  );
}
