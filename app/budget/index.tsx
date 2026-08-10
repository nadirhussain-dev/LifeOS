import { addMonths, format, isSameMonth, subMonths } from 'date-fns';
import { useRouter } from 'expo-router';
import { BarChart3, HandCoins, PiggyBank, Plus, Settings2, Wallet } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';

import { cardClass } from '@/components/ui/card';
import { ChevronBack, ChevronForward } from '@/components/ui/directional-icon';
import { EmptyState } from '@/components/ui/empty-state';
import { QueryError } from '@/components/ui/query-error';
import { Fab } from '@/components/ui/fab';
import { HeroCard } from '@/components/ui/hero-card';
import { ProgressBar } from '@/components/ui/progress-bar';
import { ScreenHeader } from '@/components/ui/screen-header';
import { SectionHeader } from '@/components/ui/section-header';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { moduleTint } from '@/constants/design-tokens';
import { colors } from '@/constants/theme';
import { ACCOUNTS } from '@/features/budget/config/budget-config';
import { ExpenseDonut } from '@/features/budget/components/expense-donut';
import { SavingsGoalCard } from '@/features/budget/components/savings-goal-card';
import { TransactionRow } from '@/features/budget/components/transaction-row';
import { formatMoney } from '@/features/budget/services/money';
import { useBudgetOverview, useSavingsGoals } from '@/features/budget/hooks/use-budget';
import { useDebts } from '@/features/budget/hooks/use-debts';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { alpha } from '@/lib/color';

const DEBT_TINT = '#6366f1';

export default function BudgetScreen() {
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const budgetTint = moduleTint('budget', scheme);
  const [anchorTime, setAnchorTime] = useState(() => Date.now());

  const overview = useBudgetOverview('month', anchorTime);
  const { data: savingsGoals = [] } = useSavingsGoals();
  const { totals: debtTotals } = useDebts();
  const {
    currency,
    summary,
    categories,
    accounts,
    periodTransactions,
    hasAny,
    isLoading,
    isError,
    refetch,
    monthlyBudgetCents,
  } = overview;

  const budgetRatio =
    monthlyBudgetCents && monthlyBudgetCents > 0 ? summary.expenseCents / monthlyBudgetCents : 0;
  const overBudget = monthlyBudgetCents != null && summary.expenseCents > monthlyBudgetCents;

  const anchor = new Date(anchorTime);
  const isCurrentMonth = isSameMonth(anchor, new Date());

  const accountMeta = new Map(ACCOUNTS.map((a) => [a.id, a]));

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader
        title={t('budget.title')}
        eyebrow={t('budget.finance')}
        tint={budgetTint}
        actions={[
          {
            icon: BarChart3,
            label: t('budget.reports'),
            onPress: () => router.push('/budget/reports'),
          },
          {
            icon: Settings2,
            label: t('budget.settings'),
            onPress: () => router.push('/budget/settings'),
          },
        ]}
      />

      {isError ? (
        <QueryError onRetry={() => refetch()} />
      ) : isLoading ? (
        <View className="gap-3 px-5 pt-2">
          <Skeleton className="h-40 w-full rounded-2xl" />
          <Skeleton className="h-24 w-full rounded-2xl" />
        </View>
      ) : !hasAny ? (
        <EmptyState
          icon={Wallet}
          title={t('budget.emptyTitle')}
          description={t('budget.homeEmptyBody')}
          tint={budgetTint}
          actionLabel={t('budget.addTransaction')}
          onAction={() => router.push('/budget/transaction')}
        />
      ) : (
        <ScrollView
          contentContainerClassName="gap-5 px-5 pb-28"
          showsVerticalScrollIndicator={false}
        >
          {/* Month selector */}
          <View className="flex-row items-center justify-between">
            <Pressable
              accessibilityRole="button"
              onPress={() => setAnchorTime(subMonths(anchor, 1).getTime())}
              hitSlop={8}
              className="h-9 w-9 items-center justify-center rounded-full bg-muted"
            >
              <ChevronBack size={18} color={colors[scheme].foreground} />
            </Pressable>
            <Text className="font-sora-semibold text-foreground">
              {format(anchor, 'MMMM yyyy')}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => !isCurrentMonth && setAnchorTime(addMonths(anchor, 1).getTime())}
              hitSlop={8}
              className="h-9 w-9 items-center justify-center rounded-full bg-muted"
              style={{ opacity: isCurrentMonth ? 0.4 : 1 }}
            >
              <ChevronForward size={18} color={colors[scheme].foreground} />
            </Pressable>
          </View>

          {/* Balance hero */}
          <HeroCard tint={budgetTint}>
            <View className="gap-4">
              <View className="items-center gap-1">
                <Text
                  className="font-sora-semibold uppercase tracking-wide"
                  style={{ color: alpha('#ffffff', 0.85), fontSize: 12 }}
                >
                  {t('budget.remainingBalance')}
                </Text>
                <Text className="font-sora-extrabold text-4xl" style={{ color: '#ffffff' }}>
                  {formatMoney(summary.balanceCents, currency)}
                </Text>
              </View>
              <View
                className="flex-row rounded-2xl p-3"
                style={{ backgroundColor: alpha('#ffffff', 0.15) }}
              >
                {[
                  { label: t('budget.income'), value: summary.incomeCents, dot: '#dcfce7' },
                  { label: t('budget.expenses'), value: summary.expenseCents, dot: '#fee2e2' },
                  { label: t('budget.savings'), value: summary.savingsCents, dot: '#e0e7ff' },
                ].map((item) => (
                  <View key={item.label} className="flex-1 items-center gap-1">
                    <Text className="font-sora-bold" style={{ color: '#ffffff' }}>
                      {formatMoney(item.value, currency)}
                    </Text>
                    <View className="flex-row items-center gap-1">
                      <View
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ backgroundColor: item.dot }}
                      />
                      <Text style={{ color: alpha('#ffffff', 0.85), fontSize: 11 }}>
                        {item.label}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            </View>
          </HeroCard>

          {/* Account balances */}
          <View className="flex-row gap-2.5">
            {accounts.map((entry) => {
              const meta = accountMeta.get(entry.account);
              const Icon = meta?.icon ?? Wallet;
              return (
                <View
                  key={entry.account}
                  className={cardClass({ padding: 'none' }, 'flex-1 items-center gap-1.5 py-3.5')}
                >
                  <Icon size={16} color={colors[scheme].mutedForeground} />
                  <Text className="font-sora-bold text-foreground">
                    {formatMoney(entry.balanceCents, currency)}
                  </Text>
                  <Text variant="caption">{meta?.label}</Text>
                </View>
              );
            })}
          </View>

          {/* Borrow & Lend */}
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/budget/debts')}
            className={cardClass({ padding: 'md' }, 'flex-row items-center gap-3')}
          >
            <View
              className="h-11 w-11 items-center justify-center rounded-xl"
              style={{ backgroundColor: alpha(DEBT_TINT, 0.14) }}
            >
              <HandCoins size={20} color={DEBT_TINT} />
            </View>
            <View className="flex-1">
              <Text className="font-sora-semibold text-foreground">{t('budget.borrowLend')}</Text>
              <Text variant="caption">
                {debtTotals.activeCount === 0
                  ? t('budget.trackIous')
                  : t('budget.youOweShort', {
                      owe: formatMoney(debtTotals.oweCents, currency),
                      owed: formatMoney(debtTotals.owedCents, currency),
                    })}
              </Text>
            </View>
            <ChevronForward size={18} color={colors[scheme].mutedForeground} />
          </Pressable>

          {/* Budget vs actual */}
          {monthlyBudgetCents != null && monthlyBudgetCents > 0 && (
            <View className={cardClass({ padding: 'md' }, 'gap-2.5')}>
              <View className="flex-row items-center justify-between">
                <Text variant="subheading">{t('budget.monthlyBudget')}</Text>
                <Text variant="caption">
                  {formatMoney(summary.expenseCents, currency)}{' '}
                  {t('budget.ofAmount', { amount: formatMoney(monthlyBudgetCents, currency) })}
                </Text>
              </View>
              <ProgressBar
                progress={Math.min(1, budgetRatio)}
                color={overBudget ? colors[scheme].destructive : colors[scheme].success}
                height={8}
              />
              <Text
                variant="caption"
                style={{ color: overBudget ? colors[scheme].destructive : colors[scheme].success }}
                className="font-sora-medium"
              >
                {overBudget
                  ? t('budget.overBudgetBy', {
                      amount: formatMoney(summary.expenseCents - monthlyBudgetCents, currency),
                    })
                  : t('budget.leftThisMonth', {
                      amount: formatMoney(monthlyBudgetCents - summary.expenseCents, currency),
                    })}
              </Text>
            </View>
          )}

          {/* Expense donut */}
          {categories.length > 0 && (
            <View className={cardClass({ padding: 'md' }, 'gap-3')}>
              <Text variant="subheading">{t('budget.whereItWent')}</Text>
              <ExpenseDonut
                categories={categories}
                totalCents={summary.expenseCents}
                currency={currency}
              />
            </View>
          )}

          {/* Savings goals */}
          <View className="gap-3">
            <View className="flex-row items-center justify-between">
              <Text variant="subheading">{t('budget.savingsGoals')}</Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push('/budget/savings/new')}
                hitSlop={8}
                className="flex-row items-center gap-1"
              >
                <Plus size={15} color={budgetTint} />
                <Text
                  variant="caption"
                  style={{ color: budgetTint }}
                  className="font-sora-semibold"
                >
                  {t('category.new')}
                </Text>
              </Pressable>
            </View>
            {savingsGoals.length === 0 ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push('/budget/savings/new')}
                className="flex-row items-center gap-3 rounded-2xl border border-dashed border-border p-4"
              >
                <PiggyBank size={20} color={colors[scheme].mutedForeground} />
                <Text variant="muted" className="flex-1">
                  {t('budget.savingsEmptyHint')}
                </Text>
              </Pressable>
            ) : (
              savingsGoals.map((goal) => (
                <SavingsGoalCard
                  key={goal.id}
                  goal={goal}
                  currency={currency}
                  onPress={(g) => router.push(`/budget/savings/${g.id}`)}
                  onAdd={(g) => router.push(`/budget/transaction?savingsGoalId=${g.id}`)}
                />
              ))
            )}
          </View>

          {/* Recent transactions */}
          <View className="gap-3">
            <SectionHeader
              title={t('budget.transactions')}
              actionLabel={periodTransactions.length > 0 ? t('budget.viewAll') : undefined}
              onAction={
                periodTransactions.length > 0
                  ? () => router.push('/budget/transactions')
                  : undefined
              }
              actionTint={budgetTint}
            />
            {periodTransactions.length === 0 ? (
              <Text variant="muted">{t('budget.noTransactionsMonth')}</Text>
            ) : (
              <View className="gap-2.5">
                {periodTransactions.slice(0, 25).map((transaction) => (
                  <TransactionRow
                    key={transaction.id}
                    transaction={transaction}
                    currency={currency}
                    onPress={(t) => router.push(`/budget/transaction?id=${t.id}`)}
                  />
                ))}
              </View>
            )}
          </View>
        </ScrollView>
      )}

      <Fab
        onPress={() => router.push('/budget/transaction')}
        accessibilityLabel={t('budget.addTransaction')}
      />
    </View>
  );
}
