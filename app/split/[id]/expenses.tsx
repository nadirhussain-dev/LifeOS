import { FlashList } from '@shopify/flash-list';
import { format } from 'date-fns';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { cardClass } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Receipt } from '@/components/ui/icons';
import { QueryError } from '@/components/ui/query-error';
import { ScreenHeader } from '@/components/ui/screen-header';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { moduleTint } from '@/constants/design-tokens';
import { useGroupDetail } from '@/features/split/hooks/use-split';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { formatMoney } from '@/features/budget/services/money';

/**
 * Every expense in a group, virtualized.
 *
 * The group screen shows the twelve most recent inline, because that section
 * lives inside its ScrollView and would otherwise mount a year of a long-running
 * group's expenses behind a summary nobody scrolled past. This is where the rest
 * are, on a list that mounts what it draws.
 */
export default function SplitGroupExpensesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const tint = moduleTint('budget', scheme);

  const { data, isLoading, isError, error, refetch } = useGroupDetail(id);

  const currency = data?.group?.currency ?? 'USD';
  const memberName = (memberId: string) => {
    const member = data?.members.find((x) => x.id === memberId);
    return member?.displayName || member?.email || t('split.someone');
  };

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title={t('split.expenses')} />

      {isError ? (
        <QueryError error={error} onRetry={() => refetch()} />
      ) : isLoading ? (
        <View className="gap-2.5 px-5">
          <Skeleton className="h-14 w-full rounded-2xl" />
          <Skeleton className="h-14 w-full rounded-2xl" />
          <Skeleton className="h-14 w-full rounded-2xl" />
        </View>
      ) : (data?.expenses.length ?? 0) === 0 ? (
        <EmptyState
          icon={Receipt}
          title={t('split.noExpensesTitle')}
          description={t('split.noExpensesBody')}
          tint={tint}
        />
      ) : (
        <FlashList
          data={data?.expenses ?? []}
          keyExtractor={(expense) => expense.id}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}
          renderItem={({ item: expense, index }) => {
            const payer = memberName(expense.paidByMemberId);
            const money = formatMoney(expense.amountCents, currency);
            return (
              <View className={cardClass({ padding: 'none' }, 'px-4')}>
                <Pressable
                  onPress={() => router.push(`/split/${id}/expense?expense=${expense.id}`)}
                  accessibilityRole="button"
                  accessibilityLabel={`${expense.description}, ${money}, ${t('split.paidBy', { name: payer })}, ${format(expense.spentAt, 'PPP')}`}
                  className={
                    index === 0
                      ? 'flex-row items-center gap-3 py-3'
                      : 'flex-row items-center gap-3 border-t border-border py-3'
                  }
                >
                  <View className="flex-1 gap-0.5">
                    <Text className="font-sora-medium text-foreground" numberOfLines={1}>
                      {expense.description}
                    </Text>
                    <Text variant="caption">
                      {t('split.paidBy', { name: payer })} · {format(expense.spentAt, 'MMM d')}
                    </Text>
                  </View>
                  <Text className="font-sora-semibold text-foreground">{money}</Text>
                </Pressable>
              </View>
            );
          }}
        />
      )}
    </View>
  );
}
