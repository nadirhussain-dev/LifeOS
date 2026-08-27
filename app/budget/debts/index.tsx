import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';

import { EmptyState } from '@/components/ui/empty-state';
import { Fab } from '@/components/ui/fab';
import { HeroCard } from '@/components/ui/hero-card';
import { HandCoins } from '@/components/ui/icons';
import { ScreenHeader } from '@/components/ui/screen-header';
import { Segmented } from '@/components/ui/segmented';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { moduleTint } from '@/constants/design-tokens';
import { DEBT_TINT } from '@/features/budget/config/budget-config';
import { DebtCard } from '@/features/budget/components/debt-card';
import { formatMoney } from '@/features/budget/services/money';
import { useBudgetSettings } from '@/features/budget/hooks/use-budget';
import { useDebts } from '@/features/budget/hooks/use-debts';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { alpha } from '@/lib/color';
import type { DebtDirection, DebtWithStatus } from '@/features/budget/types/budget.types';

/** Urgency ordering for the active list: overdue → due soon → upcoming → no date. */
const STATUS_ORDER: Record<string, number> = { overdue: 0, due_soon: 1, upcoming: 2, no_date: 3 };

function sortByUrgency(a: DebtWithStatus, b: DebtWithStatus): number {
  const s = (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9);
  if (s !== 0) return s;
  if (a.daysLeft != null && b.daysLeft != null) return a.daysLeft - b.daysLeft;
  return b.createdAt - a.createdAt;
}

export default function DebtsScreen() {
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const debtTint = useTheme().resolve(DEBT_TINT);
  const { t } = useTranslation();
  const { data: settings } = useBudgetSettings();
  const { debts, totals, isLoading } = useDebts();
  const currency = settings?.currency ?? '$';

  const filterOptions = [
    { value: 'borrowed' as const, label: t('budget.youOwe') },
    { value: 'lent' as const, label: t('budget.owesYou') },
  ];

  const [filter, setFilter] = useState<DebtDirection>('borrowed');

  const { active, settled } = useMemo(() => {
    const inFilter = debts.filter((d) => d.direction === filter);
    return {
      active: inFilter.filter((d) => !d.isSettled).sort(sortByUrgency),
      settled: inFilter
        .filter((d) => d.isSettled)
        .sort((a, b) => (b.settledAt ?? 0) - (a.settledAt ?? 0)),
    };
  }, [debts, filter]);

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader
        title={t('budget.borrowLend')}
        eyebrow={t('budget.title')}
        tint={moduleTint('budget', scheme)}
      />

      {isLoading ? (
        <View className="gap-3 px-4 pt-2">
          <Skeleton className="h-40 w-full rounded-2xl" />
          <Skeleton className="h-20 w-full rounded-2xl" />
        </View>
      ) : debts.length === 0 ? (
        <EmptyState
          icon={HandCoins}
          title={t('budget.trackWhoOwes')}
          description={t('budget.debtsEmptyBody')}
          tint={debtTint}
          actionLabel={t('budget.addAnIou')}
          onAction={() => router.push('/budget/debts/new')}
        />
      ) : (
        <ScrollView
          contentContainerClassName="gap-5 px-5 pb-28"
          showsVerticalScrollIndicator={false}
        >
          {/* Net position hero */}
          <HeroCard tint={debtTint}>
            <View className="gap-4">
              <View className="items-center gap-1">
                <Text variant="sectionLabel" style={{ color: alpha('#ffffff', 0.85) }}>
                  {t('budget.netPosition')}
                </Text>
                <Text className="font-sora-extrabold text-4xl" style={{ color: '#ffffff' }}>
                  {totals.netCents >= 0 ? '+' : '-'}
                  {formatMoney(Math.abs(totals.netCents), currency)}
                </Text>
                <Text style={{ color: alpha('#ffffff', 0.85), fontSize: 12 }}>
                  {totals.netCents >= 0 ? t('budget.owedMore') : t('budget.oweMore')}
                </Text>
              </View>
              <View
                className="flex-row rounded-2xl p-3"
                style={{ backgroundColor: alpha('#ffffff', 0.15) }}
              >
                {[
                  { label: t('budget.youOwe'), value: totals.oweCents },
                  { label: t('budget.owesYou'), value: totals.owedCents },
                ].map((item) => (
                  <View key={item.label} className="flex-1 items-center gap-1">
                    <Text className="font-sora-bold" style={{ color: '#ffffff' }}>
                      {formatMoney(item.value, currency)}
                    </Text>
                    <Text style={{ color: alpha('#ffffff', 0.85), fontSize: 11 }}>
                      {item.label}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          </HeroCard>

          <Segmented
            options={filterOptions}
            value={filter}
            onChange={setFilter}
            activeColor={debtTint}
          />

          {active.length === 0 ? (
            <Text variant="muted" className="px-1">
              {filter === 'borrowed' ? t('budget.nothingOwed') : t('budget.noOneOwesYou')}
            </Text>
          ) : (
            <View className="gap-2.5">
              {active.map((debt) => (
                <DebtCard
                  key={debt.id}
                  debt={debt}
                  onPress={(d) => router.push(`/budget/debts/${d.id}`)}
                />
              ))}
            </View>
          )}

          {settled.length > 0 && (
            <View className="gap-2.5">
              <Text variant="sectionLabel">{t('debtStatus.settled')}</Text>
              {settled.map((debt) => (
                <DebtCard
                  key={debt.id}
                  debt={debt}
                  onPress={(d) => router.push(`/budget/debts/${d.id}`)}
                />
              ))}
            </View>
          )}
        </ScrollView>
      )}

      <Fab
        onPress={() => router.push('/budget/debts/new')}
        accessibilityLabel={t('budget.addIou')}
      />
    </View>
  );
}
