import { FlashList } from '@shopify/flash-list';
import { format, isToday, isYesterday, parseISO } from 'date-fns';
import { useRouter } from 'expo-router';
import type { TFunction } from 'i18next';
import { Receipt, Search } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TextInput, View } from 'react-native';

import { EmptyState } from '@/components/ui/empty-state';
import { QueryError } from '@/components/ui/query-error';
import { ScreenHeader } from '@/components/ui/screen-header';
import { Segmented } from '@/components/ui/segmented';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { moduleTint } from '@/constants/design-tokens';
import { colors } from '@/constants/theme';
import { categoryLabelFor } from '@/features/budget/config/budget-config';
import { TransactionRow } from '@/features/budget/components/transaction-row';
import { formatMoney } from '@/features/budget/services/money';
import { useBudgetSettings, useTransactions } from '@/features/budget/hooks/use-budget';
import type { BudgetTransaction, TransactionType } from '@/features/budget/types/budget.types';
import { useColorScheme } from '@/hooks/use-color-scheme';

function dayLabel(logDate: string, t: TFunction): string {
  const date = parseISO(logDate);
  if (isToday(date)) return t('common.today');
  if (isYesterday(date)) return t('common.yesterday');
  return format(date, 'EEE, MMM d');
}

export default function TransactionsScreen() {
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const filterOptions = [
    { value: 'all' as const, label: t('budget.all') },
    { value: 'expense' as const, label: t('budget.expense') },
    { value: 'income' as const, label: t('budget.income') },
    { value: 'savings' as const, label: t('budget.savings') },
  ];
  const [filter, setFilter] = useState<'all' | TransactionType>('all');
  const [query, setQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);

  const { data: transactions = [], isLoading, isError, refetch } = useTransactions();
  const { data: settings } = useBudgetSettings();
  const currency = settings?.currency ?? '$';

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = transactions.filter((t) => {
      if (filter !== 'all' && t.type !== filter) return false;
      if (q) {
        const label = categoryLabelFor(t.type, t.category).toLowerCase();
        if (!(t.note ?? '').toLowerCase().includes(q) && !label.includes(q)) return false;
      }
      return true;
    });

    const byDay = new Map<string, BudgetTransaction[]>();
    for (const t of filtered) {
      if (!byDay.has(t.logDate)) byDay.set(t.logDate, []);
      byDay.get(t.logDate)!.push(t);
    }
    return [...byDay.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [transactions, filter, query]);

  // Flatten day groups into a single list of header/row items so the whole
  // (unbounded) history can render in a virtualized FlashList instead of a
  // ScrollView that mounts every row at once.
  const items = useMemo(() => {
    const out: (
      { type: 'header'; logDate: string; dayNet: number } | { type: 'row'; tx: BudgetTransaction }
    )[] = [];
    for (const [logDate, dayTx] of groups) {
      const dayNet = dayTx.reduce(
        (sum, t) => sum + (t.type === 'income' ? t.amountCents : -t.amountCents),
        0,
      );
      out.push({ type: 'header', logDate, dayNet });
      for (const t of dayTx) out.push({ type: 'row', tx: t });
    }
    return out;
  }, [groups]);

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader
        title={t('budget.transactions')}
        eyebrow={t('budget.title')}
        tint={moduleTint('budget', scheme)}
        actions={[
          { icon: Search, label: t('common.search'), onPress: () => setShowSearch((s) => !s) },
        ]}
      />

      <View className="gap-3 px-4 pb-2">
        <Segmented options={filterOptions} value={filter} onChange={setFilter} />
        {showSearch && (
          <View className="flex-row items-center gap-2 rounded-full bg-muted px-4 py-2.5">
            <Search size={16} color={colors[scheme].mutedForeground} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={t('budget.searchNotesCategories')}
              placeholderTextColor={colors[scheme].mutedForeground}
              accessibilityLabel={t('budget.searchTransactions')}
              autoFocus
              className="flex-1 text-foreground"
            />
          </View>
        )}
      </View>

      {isError ? (
        <QueryError onRetry={() => refetch()} message={t('budget.loadError')} />
      ) : isLoading ? (
        <View className="gap-2 px-4 pt-1">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-2xl" />
          ))}
        </View>
      ) : groups.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title={t('budget.nothingHere')}
          description={
            query || filter !== 'all'
              ? t('budget.noMatchFilter')
              : t('budget.transactionsAppearHere')
          }
          tint="#22c55e"
        />
      ) : (
        <FlashList
          data={items}
          keyExtractor={(item) => (item.type === 'header' ? `h-${item.logDate}` : item.tx.id)}
          getItemType={(item) => item.type}
          renderItem={({ item }) =>
            item.type === 'header' ? (
              <View className="flex-row items-center justify-between px-5 pb-1 pt-3">
                <Text variant="caption" className="font-sora-semibold uppercase tracking-wide">
                  {dayLabel(item.logDate, t)}
                </Text>
                <Text
                  variant="caption"
                  style={{
                    color: item.dayNet >= 0 ? colors[scheme].success : colors[scheme].destructive,
                  }}
                  className="font-sora-semibold"
                >
                  {item.dayNet >= 0 ? '+' : ''}
                  {formatMoney(item.dayNet, currency)}
                </Text>
              </View>
            ) : (
              <View className="px-4 pb-2.5">
                <TransactionRow
                  transaction={item.tx}
                  currency={currency}
                  onPress={(tx) => router.push(`/budget/transaction?id=${tx.id}`)}
                />
              </View>
            )
          }
          contentContainerStyle={{ paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}
