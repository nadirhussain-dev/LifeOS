import { format } from 'date-fns';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { CheckCircle2, Pencil, RotateCcw, Trash2 } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, TextInput, View } from 'react-native';

import { cardClass } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { GradientButton } from '@/components/ui/gradient-button';
import { ProgressRing } from '@/components/ui/progress-ring';
import { ScreenHeader } from '@/components/ui/screen-header';
import { Text } from '@/components/ui/text';
import { moduleTint } from '@/constants/design-tokens';
import { colors } from '@/constants/theme';
import { statusLabel, statusTint } from '@/features/budget/services/debt-status';
import { formatMoney, parseAmountToCents } from '@/features/budget/services/money';
import { useDebtMutations, useDebts } from '@/features/budget/hooks/use-debts';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { confirm } from '@/lib/dialog-store';

export default function DebtDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const { debts } = useDebts();
  const { addPayment, markSettled, markReopened, removeDebt } = useDebtMutations();

  const [payText, setPayText] = useState('');

  const debt = debts.find((d) => d.id === id);
  if (!debt) return null;

  const tint = debt.isSettled ? colors[scheme].success : statusTint(debt.status);
  const borrowed = debt.direction === 'borrowed';
  const payCents = parseAmountToCents(payText);

  const recordPayment = () => {
    if (payCents <= 0) return;
    addPayment.mutate({ id: debt.id, amountCents: payCents });
    setPayText('');
  };

  const confirmDelete = () => {
    void confirm({
      title: t('budget.deleteIouTitle'),
      message: t('budget.deleteIouBody', { name: debt.counterparty }),
      confirmLabel: t('common.delete'),
      cancelLabel: t('common.cancel'),
      destructive: true,
    }).then(async (ok) => {
      if (!ok) return;
      removeDebt.mutate(debt.id);
      router.back();
    });
  };

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader
        eyebrow={t('budget.borrowLend')}
        tint={moduleTint('budget', scheme)}
        actions={[
          {
            icon: Pencil,
            label: t('budget.editIou'),
            onPress: () => router.push(`/budget/debts/new?id=${debt.id}`),
          },
          {
            icon: Trash2,
            label: t('budget.deleteIou'),
            onPress: confirmDelete,
            tint: colors[scheme].destructive,
          },
        ]}
      />

      <ScrollView
        contentContainerClassName="gap-6 px-5 pt-2 pb-10"
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View className="items-center gap-4">
          <ProgressRing progress={debt.progress} size={180} strokeWidth={14} color={tint} gradient>
            <View className="items-center">
              <Text className="font-sora-extrabold text-2xl text-foreground">
                {formatMoney(
                  debt.isSettled ? debt.principalCents : debt.remainingCents,
                  debt.currency,
                )}
              </Text>
              <Text variant="caption">
                {debt.isSettled ? t('budget.settledLower') : t('budget.remaining')}
              </Text>
            </View>
          </ProgressRing>
          <View className="items-center gap-1">
            <Text className="font-sora-bold text-2xl text-foreground">{debt.counterparty}</Text>
            <Text variant="muted">
              {borrowed ? t('budget.youOwe') : t('budget.owesYou')}{' '}
              {formatMoney(debt.principalCents, debt.currency)}
              {debt.dueDate
                ? ` · ${t('budget.dueOn', { date: format(debt.dueDate, 'MMM d, yyyy') })}`
                : ''}
            </Text>
            <Text className="font-sora-semibold" style={{ color: tint }}>
              {statusLabel(debt, t)}
            </Text>
          </View>
        </View>

        {debt.note && (
          <View className={cardClass({ padding: 'md' })}>
            <Text className="text-foreground">{debt.note}</Text>
          </View>
        )}

        {debt.isSettled ? (
          <View className="gap-3">
            <View className="flex-row items-center justify-center gap-2">
              <CheckCircle2 size={18} color={colors[scheme].success} />
              <Text className="font-sora-medium text-foreground">
                {debt.settledAt
                  ? t('budget.settledOn', { date: format(debt.settledAt, 'MMM d, yyyy') })
                  : t('debtStatus.settled')}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={() => markReopened.mutate(debt.id)}
              className="flex-row items-center justify-center gap-2 rounded-2xl border border-border py-3"
            >
              <RotateCcw size={15} color={colors[scheme].mutedForeground} />
              <Text className="font-sora-medium text-muted-foreground">
                {t('budget.reopenIou')}
              </Text>
            </Pressable>
          </View>
        ) : (
          <View className="gap-3">
            <View className="gap-2.5">
              <Text variant="caption" className="font-sora-semibold uppercase tracking-wide">
                {t('budget.recordPayment')}
              </Text>
              <View className="flex-row items-center gap-2">
                <View
                  className={cardClass({ padding: 'row' }, 'flex-1 flex-row items-center gap-2')}
                >
                  <Text className="font-sora-bold text-lg" style={{ color: tint }}>
                    {debt.currency}
                  </Text>
                  <TextInput
                    value={payText}
                    onChangeText={setPayText}
                    accessibilityLabel={t('budget.paymentAmount')}
                    placeholder="0"
                    keyboardType="decimal-pad"
                    placeholderTextColor={colors[scheme].mutedForeground}
                    className="flex-1 text-foreground"
                    style={{ fontSize: 18, fontFamily: 'Sora_600SemiBold' }}
                  />
                </View>
                <Button
                  label={t('common.add')}
                  onPress={recordPayment}
                  disabled={payCents <= 0}
                  size="md"
                  variant="accent"
                />
              </View>
              <Text variant="caption">
                {borrowed ? t('budget.logYouPaid') : t('budget.logTheyPaid')} —{' '}
                {t('budget.amountLeft', {
                  amount: formatMoney(debt.remainingCents, debt.currency),
                })}
              </Text>
            </View>

            <GradientButton
              label={t('budget.markSettled')}
              tint="#22c55e"
              icon={CheckCircle2}
              onPress={() => markSettled.mutate(debt.id)}
            />
          </View>
        )}
      </ScrollView>
    </View>
  );
}
