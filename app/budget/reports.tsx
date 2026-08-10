import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';

import { cardClass } from '@/components/ui/card';
import { BarChart, type BarDatum } from '@/components/ui/bar-chart';
import { ScreenHeader } from '@/components/ui/screen-header';
import { Segmented } from '@/components/ui/segmented';
import { Text } from '@/components/ui/text';
import { ledgerTints, moduleTint, resolveTint } from '@/constants/design-tokens';
import { colors } from '@/constants/theme';
import { ExpenseDonut } from '@/features/budget/components/expense-donut';
import { periodLabel, type Period } from '@/features/budget/services/budget-stats';
import { formatMoney } from '@/features/budget/services/money';
import { useBudgetOverview } from '@/features/budget/hooks/use-budget';
import { useColorScheme } from '@/hooks/use-color-scheme';

export default function BudgetReportsScreen() {
  const scheme = useColorScheme() ?? 'light';
  const ledger = {
    income: resolveTint(ledgerTints.income, scheme),
    expense: resolveTint(ledgerTints.expense, scheme),
    savings: resolveTint(ledgerTints.savings, scheme),
  };
  const { t, i18n } = useTranslation();
  const [period, setPeriod] = useState<Period>('month');
  const [anchorTime] = useState(() => Date.now());

  const periodOptions = [
    { value: 'week' as const, label: t('budget.week') },
    { value: 'month' as const, label: t('budget.month') },
    { value: 'year' as const, label: t('budget.year') },
  ];

  const { currency, summary, categories, trend } = useBudgetOverview(period, anchorTime);

  const incomeVsExpense: BarDatum[] = [
    { label: t('budget.income'), value: summary.incomeCents / 100, color: ledger.income },
    { label: t('budget.expenses'), value: summary.expenseCents / 100, color: ledger.expense },
    { label: t('budget.savings'), value: summary.savingsCents / 100, color: ledger.savings },
  ];

  const expenseTrend: BarDatum[] = trend.map((point) => ({
    label: point.label,
    value: point.expenseCents / 100,
    color: ledger.expense,
  }));

  const summaryRows = [
    { label: t('budget.income'), value: summary.incomeCents, color: ledger.income },
    { label: t('budget.expenses'), value: summary.expenseCents, color: ledger.expense },
    { label: t('budget.savings'), value: summary.savingsCents, color: ledger.savings },
    {
      label: t('budget.netBalance'),
      value: summary.balanceCents,
      color: colors[scheme].foreground,
    },
  ];

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader
        title={t('budget.reports')}
        eyebrow={t('budget.title')}
        tint={moduleTint('budget', scheme)}
      />

      <ScrollView contentContainerClassName="gap-5 px-5 pb-10" showsVerticalScrollIndicator={false}>
        <Segmented options={periodOptions} value={period} onChange={setPeriod} />
        <Text variant="muted" className="text-center">
          {periodLabel(period, new Date(anchorTime), t, i18n.language)}
        </Text>

        <View className={cardClass({ padding: 'md' }, 'gap-2.5')}>
          {summaryRows.map((row, index) => (
            <View
              key={row.label}
              className={
                index === summaryRows.length - 1
                  ? 'flex-row items-center justify-between border-t border-border pt-2.5'
                  : 'flex-row items-center justify-between'
              }
            >
              <Text
                className={
                  index === summaryRows.length - 1
                    ? 'font-sora-semibold text-foreground'
                    : 'text-muted-foreground'
                }
              >
                {row.label}
              </Text>
              <Text className="font-sora-bold" style={{ color: row.color }}>
                {formatMoney(row.value, currency)}
              </Text>
            </View>
          ))}
        </View>

        <View className={cardClass({ padding: 'md' }, 'gap-3')}>
          <Text variant="subheading">{t('budget.incomeVsExpenses')}</Text>
          <BarChart data={incomeVsExpense} height={160} />
        </View>

        <View className={cardClass({ padding: 'md' }, 'gap-3')}>
          <Text variant="subheading">{t('budget.expensesLast6Months')}</Text>
          <BarChart data={expenseTrend} color={ledger.expense} height={160} />
        </View>

        {categories.length > 0 && (
          <View className={cardClass({ padding: 'md' }, 'gap-3')}>
            <Text variant="subheading">{t('budget.byCategory')}</Text>
            <ExpenseDonut
              categories={categories}
              totalCents={summary.expenseCents}
              currency={currency}
            />
          </View>
        )}
      </ScrollView>
    </View>
  );
}
