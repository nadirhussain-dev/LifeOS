import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, TextInput, View } from 'react-native';

import { cardClass } from '@/components/ui/card';
import { ChevronForward } from '@/components/ui/directional-icon';
import { Button } from '@/components/ui/button';
import { ScreenHeader } from '@/components/ui/screen-header';
import { Text } from '@/components/ui/text';
import { moduleTint } from '@/constants/design-tokens';
import { colors } from '@/constants/theme';
import {
  DEFAULT_CURRENCY_CODE,
  currencySymbol,
  findCurrency,
} from '@/features/budget/config/currencies';
import { parseAmountToCents } from '@/features/budget/services/money';
import { useBudgetMutations } from '@/features/budget/hooks/use-budget-mutations';
import { useBudgetSettings } from '@/features/budget/hooks/use-budget';
import { useColorScheme } from '@/hooks/use-color-scheme';

export default function BudgetSettingsScreen() {
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const { data: settings } = useBudgetSettings();
  const { saveSettings } = useBudgetMutations();

  const code = settings?.currency ?? DEFAULT_CURRENCY_CODE;
  const currency = findCurrency(code);

  const [monthlyBudget, setMonthlyBudget] = useState(
    settings?.monthlyBudgetCents ? (settings.monthlyBudgetCents / 100).toString() : '',
  );
  const [seeded, setSeeded] = useState(false);

  if (settings && !seeded) {
    setMonthlyBudget(
      settings.monthlyBudgetCents ? (settings.monthlyBudgetCents / 100).toString() : '',
    );
    setSeeded(true);
  }

  const save = () => {
    const cents = monthlyBudget.trim() ? parseAmountToCents(monthlyBudget) : null;
    saveSettings.mutate({ monthlyBudgetCents: cents });
    router.back();
  };

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader
        title={t('budget.settingsTitle')}
        eyebrow={t('budget.title')}
        tint={moduleTint('budget', scheme)}
      />

      <ScrollView
        contentContainerClassName="gap-5 px-5 pt-3 pb-10"
        keyboardShouldPersistTaps="handled"
      >
        <View className="gap-2.5">
          <Text variant="caption" className="font-sora-semibold uppercase tracking-wide">
            {t('budget.currency')}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/budget/currency')}
            className={cardClass({ padding: 'rowLg' }, 'flex-row items-center gap-3')}
          >
            <View className="h-10 w-10 items-center justify-center rounded-xl bg-muted">
              <Text className="font-sora-bold text-foreground">{currencySymbol(code)}</Text>
            </View>
            <View className="flex-1">
              <Text className="font-sora-semibold text-foreground">{currency?.name ?? code}</Text>
              <Text variant="caption">{code}</Text>
            </View>
            <ChevronForward size={18} color={colors[scheme].mutedForeground} />
          </Pressable>
        </View>

        <View className="gap-2.5">
          <Text variant="caption" className="font-sora-semibold uppercase tracking-wide">
            {t('budget.monthlyBudgetOptional')}
          </Text>
          <View className={cardClass({ padding: 'row' }, 'flex-row items-center gap-2')}>
            <Text className="font-sora-bold text-lg text-foreground">{currencySymbol(code)}</Text>
            <TextInput
              value={monthlyBudget}
              onChangeText={setMonthlyBudget}
              accessibilityLabel={t('budget.monthlyBudget')}
              placeholder="0"
              keyboardType="decimal-pad"
              placeholderTextColor={colors[scheme].mutedForeground}
              className="flex-1 text-foreground"
              style={{ fontSize: 18, fontFamily: 'Sora_600SemiBold' }}
            />
          </View>
          <Text variant="caption">{t('budget.monthlyBudgetHint')}</Text>
        </View>

        <Button label={t('budget.saveSettings')} onPress={save} size="lg" variant="accent" />
      </ScrollView>
    </View>
  );
}
