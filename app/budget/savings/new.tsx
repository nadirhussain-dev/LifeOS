import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { format } from 'date-fns';
import { useRouter } from 'expo-router';
import { CalendarDays } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, ScrollView, TextInput, View } from 'react-native';

import { cardClass } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { SheetHeader } from '@/components/ui/sheet-header';
import { Text } from '@/components/ui/text';
import { colors } from '@/constants/theme';
import { SAVINGS_COLORS } from '@/features/budget/config/budget-config';
import { formatMoney, parseAmountToCents } from '@/features/budget/services/money';
import { useBudgetMutations } from '@/features/budget/hooks/use-budget-mutations';
import { useBudgetSettings, useSavingsGoals } from '@/features/budget/hooks/use-budget';
import { useColorScheme } from '@/hooks/use-color-scheme';

export default function NewSavingsGoalScreen() {
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const { addSavingsGoal } = useBudgetMutations();
  const { data: settings } = useBudgetSettings();
  const { data: goals = [] } = useSavingsGoals();
  const currency = settings?.currency ?? '$';

  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [deadline, setDeadline] = useState<number | null>(null);
  const [showDate, setShowDate] = useState(false);

  const targetCents = parseAmountToCents(target);
  const canSave = name.trim().length > 0 && targetCents > 0;

  const handleDate = (event: DateTimePickerEvent, date?: Date) => {
    if (Platform.OS === 'android') setShowDate(false);
    if (event.type === 'set' && date) setDeadline(date.getTime());
  };

  const save = () => {
    if (!canSave) return;
    const color = SAVINGS_COLORS[goals.length % SAVINGS_COLORS.length];
    addSavingsGoal.mutate({ name: name.trim(), targetCents, colorToken: color, deadline });
    router.back();
  };

  return (
    <View className="flex-1 bg-background">
      <SheetHeader title={t('budget.newSavingsGoal')} />

      <ScrollView
        contentContainerClassName="gap-5 px-5 pt-3 pb-10"
        keyboardShouldPersistTaps="handled"
      >
        <TextInput
          value={name}
          onChangeText={setName}
          accessibilityLabel={t('budget.goalName')}
          placeholder={t('budget.goalNamePlaceholder')}
          placeholderTextColor={colors[scheme].mutedForeground}
          autoFocus
          style={{ fontSize: 22, fontFamily: 'Sora_700Bold', color: colors[scheme].foreground }}
        />

        <View className="gap-2.5">
          <Text variant="caption" className="font-sora-semibold uppercase tracking-wide">
            {t('budget.targetAmount')}
          </Text>
          <View className={cardClass({ padding: 'row' }, 'flex-row items-center gap-2')}>
            <Text className="font-sora-bold text-xl" style={{ color: '#22c55e' }}>
              {currency}
            </Text>
            <TextInput
              value={target}
              onChangeText={setTarget}
              accessibilityLabel={t('budget.targetAmount')}
              placeholder="0"
              keyboardType="decimal-pad"
              placeholderTextColor={colors[scheme].mutedForeground}
              className="flex-1 text-foreground"
              style={{ fontSize: 20, fontFamily: 'Sora_600SemiBold' }}
            />
            {targetCents > 0 && <Text variant="caption">{formatMoney(targetCents, currency)}</Text>}
          </View>
        </View>

        <View className={cardClass({ padding: 'row' }, 'flex-row items-center justify-between')}>
          <View className="flex-row items-center gap-2">
            <CalendarDays size={16} color={colors[scheme].mutedForeground} />
            <Text className="font-sora-medium text-foreground">{t('budget.deadlineOptional')}</Text>
          </View>
          {Platform.OS === 'ios' ? (
            <DateTimePicker
              value={deadline ? new Date(deadline) : new Date()}
              mode="date"
              display="compact"
              onChange={handleDate}
            />
          ) : (
            <Pressable
              accessibilityRole="button"
              onPress={() => setShowDate(true)}
              className="rounded-lg bg-muted px-3 py-1.5"
            >
              <Text className="font-sora-semibold text-foreground">
                {deadline ? format(deadline, 'MMM yyyy') : t('fields.none')}
              </Text>
            </Pressable>
          )}
        </View>
        {Platform.OS === 'android' && showDate && (
          <DateTimePicker
            value={deadline ? new Date(deadline) : new Date()}
            mode="date"
            display="default"
            onChange={handleDate}
          />
        )}

        <Button
          label={t('budget.createGoal')}
          onPress={save}
          disabled={!canSave}
          size="lg"
          variant="accent"
        />
      </ScrollView>
    </View>
  );
}
