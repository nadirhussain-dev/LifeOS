import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { Check, Search } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, TextInput, View } from 'react-native';

import { cardClass } from '@/components/ui/card';
import { ScreenHeader } from '@/components/ui/screen-header';
import { Text } from '@/components/ui/text';
import { moduleTint, moduleTints, resolveTint } from '@/constants/design-tokens';
import { colors } from '@/constants/theme';
import { CURRENCIES, DEFAULT_CURRENCY_CODE } from '@/features/budget/config/currencies';
import { useBudgetMutations } from '@/features/budget/hooks/use-budget-mutations';
import { useBudgetSettings } from '@/features/budget/hooks/use-budget';
import { useColorScheme } from '@/hooks/use-color-scheme';

// Budget's signature tint is teal. This screen had it as `#22c55e` — a green,
// and the same green the ledger used for income — so the currency picker was
// the one budget screen wearing a different module's colour.
const BUDGET_TINT = moduleTints.budget;

export default function CurrencyPickerScreen() {
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const budgetTint = resolveTint(BUDGET_TINT, scheme);
  const { t } = useTranslation();
  const { data: settings } = useBudgetSettings();
  const { saveSettings } = useBudgetMutations();
  const [query, setQuery] = useState('');

  const current = settings?.currency ?? DEFAULT_CURRENCY_CODE;

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return CURRENCIES;
    return CURRENCIES.filter(
      (c) =>
        c.code.toLowerCase().includes(q) ||
        c.name.toLowerCase().includes(q) ||
        c.symbol.toLowerCase().includes(q),
    );
  }, [query]);

  const pick = (code: string) => {
    saveSettings.mutate({ currency: code });
    router.back();
  };

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader
        title={t('budget.currency')}
        eyebrow={t('budget.title')}
        tint={moduleTint('budget', scheme)}
      />

      <View className="mx-4 mb-2 flex-row items-center gap-2 rounded-full bg-muted px-4 py-2.5">
        <Search size={16} color={colors[scheme].mutedForeground} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          accessibilityLabel={t('budget.searchCurrencies')}
          placeholder={t('budget.searchCurrencies')}
          placeholderTextColor={colors[scheme].mutedForeground}
          autoCapitalize="characters"
          className="flex-1 text-foreground"
        />
      </View>

      <FlashList
        data={results}
        keyExtractor={(item) => item.code}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}
        ItemSeparatorComponent={() => <View className="h-2" />}
        renderItem={({ item }) => {
          const selected = item.code === current;
          return (
            <Pressable
              accessibilityRole="button"
              onPress={() => pick(item.code)}
              className={cardClass({ padding: 'row' }, 'flex-row items-center gap-3')}
              style={selected ? { borderColor: budgetTint } : undefined}
            >
              <View className="h-10 w-10 items-center justify-center rounded-xl bg-muted">
                <Text className="font-sora-bold text-foreground">{item.symbol}</Text>
              </View>
              <View className="flex-1">
                <Text className="font-sora-semibold text-foreground">{item.name}</Text>
                <Text variant="caption">{item.code}</Text>
              </View>
              {selected && <Check size={20} color={budgetTint} />}
            </Pressable>
          );
        }}
      />
    </View>
  );
}
