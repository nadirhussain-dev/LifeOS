import { format } from 'date-fns/format';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';

import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cardClass } from '@/components/ui/card';
import { Segmented } from '@/components/ui/segmented';
import { SheetHeader } from '@/components/ui/sheet-header';
import { Text } from '@/components/ui/text';
import { colors } from '@/constants/theme';
import { CategoryGrid } from '@/features/budget/components/category-grid';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '@/features/budget/config/budget-config';
import { currencySymbol } from '@/features/budget/config/currencies';
import { useBudgetSettings } from '@/features/budget/hooks/use-budget';
import { useRecurringMutations } from '@/features/budget/hooks/use-recurring';
import { parseAmountToCents } from '@/features/budget/services/money';
import type { RecurringFrequencyOption } from '@/features/budget/types/budget.types';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useUnsavedChanges } from '@/hooks/use-unsaved-changes';

/** A new repeating transaction. Anchored on today by default, because "starting
 *  now" is what almost everybody means and a date picker in the way of that is
 *  a step for the minority. */
export default function NewRecurringScreen() {
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const { add } = useRecurringMutations();
  const { data: settings } = useBudgetSettings();
  const code = settings?.currency ?? 'USD';

  const [type, setType] = useState<'expense' | 'income'>('expense');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [category, setCategory] = useState<string>(EXPENSE_CATEGORIES[0].id);
  const [frequency, setFrequency] = useState<RecurringFrequencyOption>('monthly');

  const categories = type === 'expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;
  const amountCents = amount.trim() ? parseAmountToCents(amount) : 0;
  const canSave = amountCents > 0;
  const release = useUnsavedChanges(
    amount.trim() !== '' ||
      note.trim() !== '' ||
      type !== 'expense' ||
      category !== EXPENSE_CATEGORIES[0].id ||
      frequency !== 'monthly',
  );

  const save = () => {
    if (!canSave) return;
    add.mutate({
      type,
      amountCents,
      category,
      note: note.trim() || null,
      frequency,
      interval: 1,
      anchorDate: format(new Date(), 'yyyy-MM-dd'),
    });
    release();
    router.back();
  };

  return (
    <View className="flex-1 bg-background">
      <SheetHeader title={t('budget.addRecurring')} />

      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40, gap: 20 }}>
        <Segmented
          options={[
            { value: 'expense' as const, label: t('budget.expense') },
            { value: 'income' as const, label: t('budget.income') },
          ]}
          value={type}
          onChange={(next) => {
            setType(next);
            // The catalogs are disjoint, so a category picked under one type is
            // not a valid key under the other — reset rather than carry a key
            // that would resolve to "Other" without saying why.
            setCategory(
              (next === 'expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES)[0].id as string,
            );
          }}
          activeColor={colors[scheme].accent}
        />

        <View className={cardClass({ padding: 'row' }, 'flex-row items-center gap-2')}>
          <Text className="font-sora-bold text-lg text-foreground">{currencySymbol(code)}</Text>
          <Input
            surface="bare"
            value={amount}
            onChangeText={setAmount}
            accessibilityLabel={t('budget.amount')}
            placeholder="0"
            keyboardType="decimal-pad"
            className="flex-1 text-foreground"
            style={{ fontSize: 18, fontFamily: 'Sora_600SemiBold' }}
          />
        </View>

        <View className="gap-2">
          <Text variant="sectionLabel">{t('fields.category')}</Text>
          <CategoryGrid items={categories} value={category} onChange={setCategory} />
        </View>

        <View className="gap-2">
          <Text variant="sectionLabel">{t('budget.repeats')}</Text>
          <Segmented
            options={[
              { value: 'weekly' as const, label: t('budget.recurringWeeklyShort') },
              { value: 'monthly' as const, label: t('budget.recurringMonthlyShort') },
              { value: 'yearly' as const, label: t('budget.recurringYearlyShort') },
            ]}
            value={frequency}
            onChange={setFrequency}
            activeColor={colors[scheme].accent}
          />
        </View>

        <Input
          value={note}
          onChangeText={setNote}
          accessibilityLabel={t('fields.notes')}
          placeholder={t('budget.recurringNotePlaceholder')}
          surface="card"
          cardPadding="md"
          className="text-base"
        />

        <Button
          label={t('budget.addRecurring')}
          onPress={save}
          disabled={!canSave}
          size="lg"
          variant="accent"
        />
      </ScrollView>
    </View>
  );
}
