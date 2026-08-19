import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { ProgressBar } from '@/components/ui/progress-bar';
import { Text } from '@/components/ui/text';
import { colors } from '@/constants/theme';
import { expenseCategoryMeta } from '@/features/budget/config/budget-config';
import { formatMoney } from '@/features/budget/services/money';
import type { CategoryBudgetStatus } from '@/features/budget/types/budget.types';
import { useColorScheme } from '@/hooks/use-color-scheme';

type Props = {
  statuses: CategoryBudgetStatus[];
  currency: string;
};

/**
 * Where each capped category stands this month.
 *
 * Over-budget rows are tinted destructive rather than merely full: a bar that
 * can only reach 100% cannot distinguish "just over" from "three times over",
 * and the amount is what tells you which — so the remaining figure goes
 * negative on screen rather than bottoming out at zero.
 */
export function CategoryBudgetList({ statuses, currency }: Props) {
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();

  return (
    <View>
      {statuses.map((status) => {
        const meta = expenseCategoryMeta(status.category, scheme);
        const Icon = meta.icon;
        const tint = status.isOver ? colors[scheme].destructive : meta.tint;

        return (
          <View key={status.category} className="gap-1.5 py-3">
            <View className="flex-row items-center gap-2.5">
              <Icon size={15} color={tint} />
              <Text className="flex-1 font-sora-medium">{meta.label}</Text>
              <Text variant="caption" style={{ color: tint }}>
                {status.isOver
                  ? t('budget.overBy', {
                      amount: formatMoney(-status.remainingCents, currency),
                    })
                  : t('budget.leftOf', {
                      amount: formatMoney(status.remainingCents, currency),
                      limit: formatMoney(status.limitCents, currency),
                    })}
              </Text>
            </View>
            {/* ProgressBar clamps internally, which is right for the bar and
                wrong for the number beside it — hence both. */}
            <ProgressBar progress={status.ratio} color={tint} height={6} />
          </View>
        );
      })}
    </View>
  );
}
