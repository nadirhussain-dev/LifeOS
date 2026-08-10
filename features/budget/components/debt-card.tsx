import { ArrowDownLeft, ArrowUpRight, BellRing } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { cardClass } from '@/components/ui/card';
import { ProgressBar } from '@/components/ui/progress-bar';
import { Text } from '@/components/ui/text';
import { colors } from '@/constants/design-tokens';
import { statusLabel, statusTint } from '@/features/budget/services/debt-status';
import { formatMoney } from '@/features/budget/services/money';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { alpha } from '@/lib/color';
import type { DebtWithStatus } from '@/features/budget/types/budget.types';

type Props = {
  debt: DebtWithStatus;
  onPress: (debt: DebtWithStatus) => void;
};

/** One IOU row: who, how much is left, and a colour-coded timing pill. A
 * partially-paid debt also shows a slim progress bar. */
export function DebtCard({ debt, onPress }: Props) {
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const borrowed = debt.direction === 'borrowed';
  const Icon = borrowed ? ArrowUpRight : ArrowDownLeft;
  const tint = debt.isSettled ? colors[scheme].success : statusTint(debt.status);
  const partiallyPaid = debt.paidCents > 0 && !debt.isSettled;

  return (
    <Pressable
      onPress={() => onPress(debt)}
      className={cardClass({ padding: 'md', elevation: 'e1' }, 'gap-3')}
      accessibilityRole="button"
    >
      <View className="flex-row items-center gap-3">
        <View
          className="h-10 w-10 items-center justify-center rounded-xl"
          style={{ backgroundColor: alpha(tint, 0.14) }}
        >
          <Icon size={19} color={tint} strokeWidth={2.4} />
        </View>
        <View className="flex-1">
          <Text className="font-sora-semibold text-foreground" numberOfLines={1}>
            {debt.counterparty}
          </Text>
          <Text variant="caption">{borrowed ? t('budget.youOwe') : t('budget.owesYou')}</Text>
        </View>
        <View className="items-end">
          <Text
            className="font-sora-bold text-foreground"
            style={{ textDecorationLine: debt.isSettled ? 'line-through' : 'none' }}
          >
            {formatMoney(debt.isSettled ? debt.principalCents : debt.remainingCents, debt.currency)}
          </Text>
          <View className="flex-row items-center gap-1">
            {debt.reminderDaysBefore != null && !debt.isSettled && (
              <BellRing size={11} color={tint} />
            )}
            <Text className="font-sora-medium" style={{ color: tint, fontSize: 11 }}>
              {statusLabel(debt, t)}
            </Text>
          </View>
        </View>
      </View>

      {partiallyPaid && (
        <View className="gap-1">
          <ProgressBar progress={debt.progress} color={tint} height={5} />
          <Text variant="caption">
            {formatMoney(debt.paidCents, debt.currency)} of{' '}
            {formatMoney(debt.principalCents, debt.currency)} paid
          </Text>
        </View>
      )}
    </Pressable>
  );
}
