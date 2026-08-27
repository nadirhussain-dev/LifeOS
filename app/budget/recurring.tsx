import { format, parseISO } from 'date-fns';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, Switch, View } from 'react-native';

import { cardClass } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Repeat, Trash2 } from '@/components/ui/icons';
import { ScreenHeader } from '@/components/ui/screen-header';
import { Text } from '@/components/ui/text';
import { colors } from '@/constants/theme';
import { expenseCategoryMeta } from '@/features/budget/config/budget-config';
import { useBudgetSettings } from '@/features/budget/hooks/use-budget';
import { useRecurring, useRecurringMutations } from '@/features/budget/hooks/use-recurring';
import { formatMoney } from '@/features/budget/services/money';
import { nextOccurrence } from '@/features/budget/services/recurring-transactions';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { confirm } from '@/lib/dialog-store';

const FREQUENCY_LABEL_KEY: Record<string, string> = {
  weekly: 'budget.recurringWeekly',
  monthly: 'budget.recurringMonthly',
  yearly: 'budget.recurringYearly',
};

/**
 * The rules that post transactions on their own.
 *
 * Occurrences already written are ordinary transactions and are edited or
 * deleted on the transactions screen like anything else — this screen is only
 * the rules. Pausing a rule leaves its history alone, which is why "active" is a
 * switch rather than a delete: stopping a subscription should not erase the
 * eleven months you paid for it.
 */
export default function RecurringScreen() {
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const { data: rules = [] } = useRecurring();
  const { setActive, remove } = useRecurringMutations();
  const { data: settings } = useBudgetSettings();
  const currency = settings?.currency ?? 'USD';

  const confirmDelete = (id: string, label: string) => {
    void confirm({
      title: t('budget.deleteRecurringTitle'),
      message: t('budget.deleteRecurringBody', { name: label }),
      confirmLabel: t('common.delete'),
      cancelLabel: t('common.cancel'),
      destructive: true,
    }).then((ok) => {
      if (ok) remove.mutate(id);
    });
  };

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title={t('budget.recurring')} />

      {rules.length === 0 ? (
        <EmptyState
          icon={Repeat}
          title={t('budget.noRecurringTitle')}
          description={t('budget.noRecurringBody')}
          actionLabel={t('budget.addRecurring')}
          onAction={() => router.push('/budget/recurring/new')}
        />
      ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40, gap: 10 }}>
          {rules.map((rule) => {
            const meta = expenseCategoryMeta(rule.category, scheme);
            const Icon = meta.icon;
            const next = nextOccurrence(rule, new Date());
            const label = rule.note?.trim() || meta.label;

            return (
              <View key={rule.id} className={cardClass({ padding: 'md' }, 'gap-2')}>
                <View className="flex-row items-center gap-3">
                  <Icon size={16} color={meta.tint} />
                  <View className="flex-1">
                    <Text className="font-sora-medium">{label}</Text>
                    <Text variant="caption">
                      {t(FREQUENCY_LABEL_KEY[rule.frequency], { count: rule.interval })}
                      {next && rule.isActive
                        ? ` · ${t('budget.nextOn', {
                            date: format(parseISO(next), 'MMM d'),
                          })}`
                        : ''}
                    </Text>
                  </View>
                  <Text className="font-sora-semibold text-foreground">
                    {formatMoney(rule.amountCents, currency)}
                  </Text>
                </View>

                <View className="flex-row items-center justify-between">
                  <View className="flex-row items-center gap-2">
                    <Switch
                      value={rule.isActive}
                      onValueChange={(isActive) => setActive.mutate({ id: rule.id, isActive })}
                      trackColor={{ true: colors[scheme].accent, false: colors[scheme].border }}
                    />
                    <Text variant="caption">
                      {rule.isActive ? t('budget.recurringActive') : t('budget.recurringPaused')}
                    </Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('common.deleteNamed', { name: label })}
                    hitSlop={8}
                    onPress={() => confirmDelete(rule.id, label)}
                  >
                    <Trash2 size={16} color={colors[scheme].mutedForeground} />
                  </Pressable>
                </View>
              </View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}
