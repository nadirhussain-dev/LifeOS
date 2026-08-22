import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { format } from 'date-fns';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { TFunction } from 'i18next';
import { BellRing, CalendarDays, X } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, ScrollView, View } from 'react-native';

import { Input } from '@/components/ui/input';
import { Chip } from '@/components/ui/chip';
import { cardClass } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Segmented } from '@/components/ui/segmented';
import { SheetHeader } from '@/components/ui/sheet-header';
import { Text } from '@/components/ui/text';
import { colors } from '@/constants/theme';
import { DEBT_TINT } from '@/features/budget/config/budget-config';
import { REMINDER_DAY_OPTIONS } from '@/features/budget/services/debt-status';
import { formatMoney, parseAmountToCents } from '@/features/budget/services/money';
import { useBudgetSettings } from '@/features/budget/hooks/use-budget';
import { useDebtMutations, useDebts } from '@/features/budget/hooks/use-debts';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useUnsavedChanges } from '@/hooks/use-unsaved-changes';
import { useTheme } from '@/hooks/use-theme';
import { notificationsAvailable } from '@/lib/notifications';
import type { DebtDirection } from '@/features/budget/types/budget.types';

function reminderLabel(days: number, t: TFunction): string {
  if (days === 0) return t('budget.onTheDay');
  if (days === 7) return t('budget.oneWeek');
  return t('budget.daysCount', { count: days });
}

export default function DebtFormScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const debtTint = useTheme().resolve(DEBT_TINT);
  const { t } = useTranslation();
  const { data: settings } = useBudgetSettings();
  const { debts } = useDebts();
  const { addDebt, editDebt } = useDebtMutations();
  const currency = settings?.currency ?? '$';
  const isEdit = !!id;

  const directionOptions = [
    { value: 'borrowed' as const, label: t('budget.iBorrowed') },
    { value: 'lent' as const, label: t('budget.iLent') },
  ];

  const [direction, setDirection] = useState<DebtDirection>('borrowed');
  const [counterparty, setCounterparty] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [dueDate, setDueDate] = useState<number | null>(null);
  const [reminderDaysBefore, setReminderDaysBefore] = useState<number | null>(1);
  const [showDate, setShowDate] = useState(false);
  const [seeded, setSeeded] = useState(false);

  const existing = isEdit ? debts.find((d) => d.id === id) : undefined;
  if (isEdit && existing && !seeded) {
    setDirection(existing.direction);
    setCounterparty(existing.counterparty);
    setAmount((existing.principalCents / 100).toString());
    setNote(existing.note ?? '');
    setDueDate(existing.dueDate);
    setReminderDaysBefore(existing.reminderDaysBefore);
    setSeeded(true);
  }

  const principalCents = parseAmountToCents(amount);

  /** Create-and-edit in one screen, like the transaction sheet — the baseline
   *  is a ref re-taken once the edit seed has landed. */
  const snapshot = JSON.stringify([
    direction,
    counterparty.trim(),
    amount.trim(),
    note.trim(),
    dueDate,
    reminderDaysBefore,
  ]);
  const baseline = useRef(snapshot);
  const rebased = useRef(false);
  if (seeded && !rebased.current) {
    rebased.current = true;
    baseline.current = snapshot;
  }
  const release = useUnsavedChanges(snapshot !== baseline.current);
  const canSave = counterparty.trim().length > 0 && principalCents > 0;

  const handleDate = (event: DateTimePickerEvent, date?: Date) => {
    if (Platform.OS === 'android') setShowDate(false);
    if (event.type === 'set' && date) setDueDate(date.getTime());
  };

  const save = () => {
    if (!canSave) return;
    const effectiveReminder = dueDate ? reminderDaysBefore : null;
    if (isEdit && existing) {
      editDebt.mutate({
        id: existing.id,
        input: {
          counterparty: counterparty.trim(),
          principalCents,
          note: note.trim() || null,
          dueDate,
          reminderDaysBefore: effectiveReminder,
        },
      });
    } else {
      addDebt.mutate({
        direction,
        counterparty: counterparty.trim(),
        principalCents,
        currency,
        note: note.trim() || null,
        dueDate,
        reminderDaysBefore: effectiveReminder,
      });
    }
    release();
    router.back();
  };

  return (
    <View className="flex-1 bg-background">
      <SheetHeader title={isEdit ? t('budget.editIou') : t('budget.newIou')} />

      <ScrollView
        contentContainerClassName="gap-5 px-5 pt-3 pb-10"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {isEdit ? (
          <View className="items-center">
            <Text variant="muted">
              {direction === 'borrowed' ? t('budget.youBorrowedFrom') : t('budget.youLentTo')}
            </Text>
          </View>
        ) : (
          <Segmented
            options={directionOptions}
            value={direction}
            onChange={setDirection}
            activeColor={debtTint}
          />
        )}

        <Input
          surface="bare"
          value={counterparty}
          onChangeText={setCounterparty}
          accessibilityLabel={t('budget.person')}
          placeholder={t('budget.personName')}
          autoFocus={!isEdit}
          style={{ fontSize: 22, fontFamily: 'Sora_700Bold', color: colors[scheme].foreground }}
        />

        <View className="gap-2.5">
          <Text variant="sectionLabel">{t('budget.amount')}</Text>
          <View className={cardClass({ padding: 'row' }, 'flex-row items-center gap-2')}>
            <Text className="font-sora-bold text-xl" style={{ color: debtTint }}>
              {currency}
            </Text>
            <Input
              surface="bare"
              value={amount}
              onChangeText={setAmount}
              accessibilityLabel={t('budget.amount')}
              placeholder="0"
              keyboardType="decimal-pad"
              className="flex-1 text-foreground"
              style={{ fontSize: 20, fontFamily: 'Sora_600SemiBold' }}
            />
            {principalCents > 0 && (
              <Text variant="caption">{formatMoney(principalCents, currency)}</Text>
            )}
          </View>
        </View>

        <View className={cardClass({ padding: 'row' }, 'flex-row items-center justify-between')}>
          <View className="flex-row items-center gap-2">
            <CalendarDays size={16} color={colors[scheme].mutedForeground} />
            <Text className="font-sora-medium text-foreground">{t('budget.paybackDeadline')}</Text>
          </View>
          <View className="flex-row items-center gap-2">
            {Platform.OS === 'ios' ? (
              <DateTimePicker
                value={dueDate ? new Date(dueDate) : new Date()}
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
                  {dueDate ? format(dueDate, 'MMM d, yyyy') : t('fields.none')}
                </Text>
              </Pressable>
            )}
            {dueDate != null && (
              <Pressable
                accessibilityRole="button"
                onPress={() => setDueDate(null)}
                hitSlop={8}
                className="h-6 w-6 items-center justify-center rounded-full bg-muted"
              >
                <X size={13} color={colors[scheme].mutedForeground} />
              </Pressable>
            )}
          </View>
        </View>
        {Platform.OS === 'android' && showDate && (
          <DateTimePicker
            value={dueDate ? new Date(dueDate) : new Date()}
            mode="date"
            display="default"
            onChange={handleDate}
          />
        )}

        {dueDate != null && (
          <View className="gap-2.5">
            <View className="flex-row items-center gap-2">
              <BellRing size={14} color={colors[scheme].mutedForeground} />
              <Text variant="sectionLabel">{t('budget.remindMeBefore')}</Text>
            </View>
            <View className="flex-row flex-wrap gap-2">
              {[null, ...REMINDER_DAY_OPTIONS].map((days) => {
                const selected = reminderDaysBefore === days;
                return (
                  <Chip
                    key={days ?? 'off'}
                    label={days == null ? t('budget.off') : reminderLabel(days, t)}
                    selected={selected}
                    tint={debtTint}
                    onPress={() => setReminderDaysBefore(days)}
                    className="py-2"
                  />
                );
              })}
            </View>
            {!notificationsAvailable && reminderDaysBefore != null && (
              <Text variant="caption">{t('reminders.notAvailable')}</Text>
            )}
          </View>
        )}

        <Input
          value={note}
          onChangeText={setNote}
          accessibilityLabel={t('budget.note')}
          placeholder={t('budget.whatFor')}
        />

        <Button
          label={isEdit ? t('budget.saveChanges') : t('budget.addIou')}
          onPress={save}
          disabled={!canSave}
          size="lg"
          variant="accent"
        />
      </ScrollView>
    </View>
  );
}
