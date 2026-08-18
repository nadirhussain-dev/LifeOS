import { useTranslation } from 'react-i18next';
import { TextInput, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { colors } from '@/constants/theme';
import { EXPENSE_CATEGORIES, expenseCategoryMeta } from '@/features/budget/config/budget-config';
import { capsExceedMonthlyBudget } from '@/features/budget/services/category-budgets';
import { currencySymbol } from '@/features/budget/config/currencies';
import { useColorScheme } from '@/hooks/use-color-scheme';

type Props = {
  limits: Record<string, number>;
  currencyCode: string;
  monthlyBudgetCents: number | null;
  /** Called with null to clear a cap — which is not the same as zero. */
  onChange: (category: string, limitCents: number | null) => void;
};

/**
 * One field per expense category.
 *
 * Every category is listed, not only the capped ones, because the alternative is
 * an "add a cap" flow with a category picker for a fixed catalog of ten — more
 * taps to reach the same ten fields.
 *
 * An empty field clears the cap; a field containing 0 sets a cap of zero. Those
 * are deliberately different, and the hint says so: zero means "nothing here
 * this month" and reads as over budget the moment anything is spent, while empty
 * means the app has no opinion about the category.
 */
export function CategoryCapEditor({ limits, currencyCode, monthlyBudgetCents, onChange }: Props) {
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const symbol = currencySymbol(currencyCode);
  const exceeds = capsExceedMonthlyBudget(limits, monthlyBudgetCents);

  return (
    <View className="gap-2">
      {EXPENSE_CATEGORIES.map((category) => {
        const meta = expenseCategoryMeta(category.id, scheme);
        const Icon = meta.icon;
        const cents = limits[category.id];

        return (
          <View key={category.id} className="flex-row items-center gap-3 py-1.5">
            <Icon size={16} color={meta.tint} />
            <Text className="flex-1 font-sora-medium">{meta.label}</Text>
            <Text variant="caption">{symbol}</Text>
            <TextInput
              defaultValue={cents != null ? String(cents / 100) : ''}
              onChangeText={(text) => {
                const trimmed = text.trim();
                if (trimmed === '') {
                  onChange(category.id, null);
                  return;
                }
                const parsed = Number(trimmed.replace(',', '.'));
                if (!Number.isFinite(parsed) || parsed < 0) return;
                onChange(category.id, Math.round(parsed * 100));
              }}
              accessibilityLabel={t('budget.categoryCapFor', { category: meta.label })}
              placeholder="—"
              keyboardType="decimal-pad"
              placeholderTextColor={colors[scheme].mutedForeground}
              className="w-20 rounded-lg border border-border px-2 py-1.5 text-right text-foreground"
            />
          </View>
        );
      })}

      {/* Said, not enforced. Capping categories above the monthly budget is a
          contradiction the user is allowed to hold mid-way through re-planning,
          and refusing the edit would be the app arguing about their money. */}
      {exceeds && (
        <Text variant="caption" style={{ color: colors[scheme].warning }}>
          {t('budget.capsExceedMonthly')}
        </Text>
      )}
    </View>
  );
}
