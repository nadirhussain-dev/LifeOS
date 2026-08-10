import DateTimePicker from '@react-native-community/datetimepicker';
import { format } from 'date-fns';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { CalendarDays, Check, Trash2 } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from 'react-native';

import { cardClass } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { InlineError } from '@/components/ui/query-error';
import { SheetHeader } from '@/components/ui/sheet-header';
import { Text } from '@/components/ui/text';
import { colors as dsColors, moduleTint } from '@/constants/design-tokens';
import { colors } from '@/constants/theme';
import { formatMoney, parseAmountToCents } from '@/features/budget/services/money';
import { MemberAvatars } from '@/features/split/components/member-avatars';
import { useGroupDetail, useSplitMutations } from '@/features/split/hooks/use-split';
import { splitEvenly } from '@/features/split/services/split-math';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { alpha } from '@/lib/color';
import { confirm } from '@/lib/dialog-store';
import { toast } from '@/lib/toast-store';

type Mode = 'equal' | 'exact';

/**
 * Add or edit an expense.
 *
 * The split is always materialised into whole cents before it is sent — the
 * server rejects a split that does not sum to the amount, so the preview here
 * shows exactly what will be written, including which member absorbs the odd
 * cent when the amount does not divide.
 *
 * Two things a splitting app cannot really do without, and this one couldn't:
 * dating an expense in the past (bills get entered the next morning), and
 * unequal shares (one person had the steak). `SplitMode` in the types and the
 * sum invariant in the database both already allowed for exact shares — only
 * the UI was missing, so `mode: 'exact'` had no way to be reached.
 */
export default function SplitExpenseScreen() {
  const { id, expense: expenseId } = useLocalSearchParams<{ id: string; expense?: string }>();
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const tint = moduleTint('budget', scheme);
  const c = dsColors[scheme];

  const { data } = useGroupDetail(id);
  const { addExpense, editExpense, removeExpense } = useSplitMutations(id);

  const existing = useMemo(
    () => data?.expenses.find((e) => e.id === expenseId) ?? null,
    [data, expenseId],
  );
  /**
   * Who this form may involve: everyone currently in the group, plus anybody
   * removed who was already part of THIS expense.
   *
   * A former member cannot be added to something new, but editing a dinner they
   * were at must not quietly drop their share — that would rewrite history and
   * silently move their portion onto everyone else.
   */
  const members = useMemo(() => {
    const active = data?.activeMembers ?? [];
    if (!existing || !data) return active;
    const historic = new Set(
      data.shares.filter((sh) => sh.expenseId === existing.id).map((sh) => sh.memberId),
    );
    historic.add(existing.paidByMemberId);
    const activeIds = new Set(active.map((m) => m.id));
    return [...active, ...data.members.filter((m) => !activeIds.has(m.id) && historic.has(m.id))];
  }, [data, existing]);

  /** Former members kept above are shown, but cannot be newly ticked. */
  const isFormer = (memberId: string) =>
    (data?.members.find((m) => m.id === memberId)?.removedAt ?? null) !== null;
  const currency = data?.group?.currency ?? '$';

  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [paidBy, setPaidBy] = useState<string | null>(null);
  const [participants, setParticipants] = useState<string[]>([]);
  const [mode, setMode] = useState<Mode>('equal');
  /** Per-member typed amounts, only meaningful in exact mode. */
  const [exact, setExact] = useState<Record<string, string>>({});
  const [spentAt, setSpentAt] = useState<Date>(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [seeded, setSeeded] = useState(false);

  // Seeding in an effect, not the render body: setState during render double-
  // renders and, worse, never re-runs when the query resolves a second time
  // (a refetch after an edit elsewhere), so the form silently kept stale values.
  useEffect(() => {
    if (seeded || !data) return;
    if (existing) {
      const existingShares = data.shares.filter((s) => s.expenseId === existing.id);
      const even = splitEvenly(
        existing.amountCents,
        existingShares.map((s) => s.memberId),
      );
      const wasEqual = existingShares.every(
        (s) => even.find((e) => e.memberId === s.memberId)?.shareCents === s.shareCents,
      );
      setDescription(existing.description);
      setAmount((existing.amountCents / 100).toString());
      setPaidBy(existing.paidByMemberId);
      setParticipants(existingShares.map((s) => s.memberId));
      setSpentAt(new Date(existing.spentAt));
      setMode(wasEqual ? 'equal' : 'exact');
      setExact(
        Object.fromEntries(
          existingShares.map((s) => [s.memberId, (s.shareCents / 100).toString()]),
        ),
      );
    } else {
      setPaidBy(members[0]?.id ?? null);
      setParticipants(members.map((m) => m.id));
    }
    setSeeded(true);
  }, [seeded, data, existing, members]);

  const amountCents = parseAmountToCents(amount);

  const shares = useMemo(() => {
    if (mode === 'equal') return splitEvenly(amountCents, participants);
    return participants.map((memberId) => ({
      memberId,
      shareCents: parseAmountToCents(exact[memberId] ?? ''),
    }));
  }, [mode, amountCents, participants, exact]);

  const assigned = shares.reduce((sum, s) => sum + s.shareCents, 0);
  const remaining = amountCents - assigned;
  const balanced = mode === 'equal' || remaining === 0;

  const canSave =
    description.trim().length > 0 &&
    amountCents > 0 &&
    !!paidBy &&
    participants.length > 0 &&
    balanced &&
    !addExpense.isPending &&
    !editExpense.isPending;

  const toggle = (memberId: string) => {
    // Removing a former member from an expense is fine; adding them back is not
    // — they are no longer in the group.
    if (isFormer(memberId) && !participants.includes(memberId)) return;
    void Haptics.selectionAsync();
    setParticipants((prev) =>
      prev.includes(memberId) ? prev.filter((m) => m !== memberId) : [...prev, memberId],
    );
  };

  /** Hands the untyped remainder to everybody who hasn't been given a number
   *  yet — the "I only know what my bit was" case. */
  const spreadRemainder = () => {
    const untouched = participants.filter((m) => !parseAmountToCents(exact[m] ?? ''));
    if (untouched.length === 0 || remaining <= 0) return;
    const even = splitEvenly(remaining, untouched);
    setExact((prev) => ({
      ...prev,
      ...Object.fromEntries(even.map((e) => [e.memberId, (e.shareCents / 100).toString()])),
    }));
    void Haptics.selectionAsync();
  };

  const save = () => {
    if (!canSave) return;
    const payload = {
      paidByMemberId: paidBy!,
      description: description.trim(),
      amountCents,
      spentAt: spentAt.getTime(),
      note: null,
      shares,
    };
    // The success haptic used to fire on tap, before the write — so a rejected
    // split still felt like a saved one.
    const onSuccess = () => {
      toast.success(t('split.expenseAdded'));
      router.back();
    };
    const onError = () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    if (existing)
      editExpense.mutate({ expenseId: existing.id, ...payload }, { onSuccess, onError });
    else addExpense.mutate({ currency, ...payload }, { onSuccess, onError });
  };

  /** A shared ledger everybody else can see: this one keeps its confirmation
   *  rather than becoming a quietly-undoable toast. */
  const confirmDelete = () => {
    if (!existing) return;
    void confirm({
      title: t('split.deleteExpenseTitle'),
      message: t('split.deleteExpenseBody'),
      confirmLabel: t('common.delete'),
      cancelLabel: t('common.cancel'),
      destructive: true,
    }).then(async (ok) => {
      if (!ok) return;
      removeExpense.mutate(existing.id, {
        onSuccess: () => {
          toast.success(t('split.expenseDeleted'));
          router.back();
        },
      });
    });
  };

  const memberName = (memberId: string) => {
    const m = members.find((x) => x.id === memberId);
    return m?.displayName || m?.email || t('split.someone');
  };

  return (
    <View className="flex-1 bg-background">
      <SheetHeader
        title={existing ? t('split.editExpense') : t('split.addExpense')}
        right={
          existing ? (
            <Pressable
              onPress={confirmDelete}
              hitSlop={10}
              className="h-9 w-9 items-center justify-center"
              accessibilityRole="button"
              accessibilityLabel={t('common.delete')}
            >
              <Trash2 size={18} color={colors[scheme].destructive} />
            </Pressable>
          ) : undefined
        }
      />

      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerClassName="gap-6 px-5 pt-3 pb-10"
          keyboardShouldPersistTaps="handled"
        >
          <TextInput
            value={description}
            onChangeText={setDescription}
            accessibilityLabel={t('split.description')}
            placeholder={t('split.descriptionPlaceholder')}
            placeholderTextColor={colors[scheme].mutedForeground}
            autoFocus={!existing}
            maxLength={80}
            style={{ fontSize: 22, fontFamily: 'Sora_700Bold', color: colors[scheme].foreground }}
          />

          <View className="flex-row gap-3">
            <View className="flex-1 gap-2">
              <Text variant="micro">{t('split.amount')}</Text>
              <TextInput
                value={amount}
                onChangeText={setAmount}
                accessibilityLabel={t('split.amount')}
                placeholder="0.00"
                keyboardType="decimal-pad"
                placeholderTextColor={colors[scheme].mutedForeground}
                className={cardClass({ padding: 'row' }, 'text-2xl text-foreground')}
              />
            </View>
            <View className="gap-2">
              <Text variant="micro">{t('split.date')}</Text>
              <Pressable
                onPress={() => setShowDatePicker(true)}
                accessibilityRole="button"
                accessibilityLabel={`${t('split.date')}: ${format(spentAt, 'PPP')}`}
                className={cardClass({ padding: 'none' }, 'flex-row items-center gap-2 px-4')}
                style={{ height: 56 }}
              >
                <CalendarDays size={16} color={colors[scheme].mutedForeground} />
                <Text className="font-sora-medium text-foreground">{format(spentAt, 'd MMM')}</Text>
              </Pressable>
            </View>
          </View>

          {showDatePicker ? (
            <DateTimePicker
              value={spentAt}
              mode="date"
              // Nobody splits a bill they have not had yet.
              maximumDate={new Date()}
              onChange={(event, selected) => {
                setShowDatePicker(Platform.OS === 'ios' && event.type !== 'dismissed');
                if (selected) setSpentAt(selected);
              }}
            />
          ) : null}

          <View className="gap-2">
            <Text variant="micro">{t('split.paidByLabel')}</Text>
            <View className="flex-row flex-wrap gap-2">
              {members.map((m) => {
                const selected = m.id === paidBy;
                const former = isFormer(m.id);
                // A former member stays selectable only while they are already
                // the payer of the expense being edited.
                if (former && !selected) return null;
                return (
                  <Pressable
                    key={m.id}
                    onPress={() => {
                      void Haptics.selectionAsync();
                      setPaidBy(m.id);
                    }}
                    accessibilityRole="radio"
                    accessibilityState={{ selected, checked: selected }}
                    accessibilityLabel={memberName(m.id)}
                    style={{
                      minHeight: 44,
                      justifyContent: 'center',
                      borderColor: selected ? tint : colors[scheme].border,
                      backgroundColor: selected ? tint : 'transparent',
                    }}
                    className="rounded-full border px-3.5 py-1.5"
                  >
                    <Text
                      className={selected ? 'font-sora-medium text-white' : 'text-muted-foreground'}
                    >
                      {memberName(m.id)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Split preview: exactly the cents that will be written, so the odd
              cent is visible rather than a surprise. */}
          <View className="gap-2.5">
            <View className="flex-row items-center justify-between">
              <Text variant="micro">{t('split.splitBetween')}</Text>
              <View className="flex-row rounded-full border border-border p-0.5">
                {(['equal', 'exact'] as Mode[]).map((option) => {
                  const selected = mode === option;
                  return (
                    <Pressable
                      key={option}
                      onPress={() => {
                        void Haptics.selectionAsync();
                        // Carry the equal split in as the starting point, so
                        // "exact" means adjust-from-here rather than start-blank.
                        if (option === 'exact') {
                          setExact(
                            Object.fromEntries(
                              splitEvenly(amountCents, participants).map((s) => [
                                s.memberId,
                                (s.shareCents / 100).toString(),
                              ]),
                            ),
                          );
                        }
                        setMode(option);
                      }}
                      accessibilityRole="radio"
                      accessibilityState={{ selected, checked: selected }}
                      accessibilityLabel={t(`split.mode.${option}`)}
                      className="rounded-full px-3 py-1.5"
                      style={{ backgroundColor: selected ? alpha(tint, 0.16) : 'transparent' }}
                    >
                      <Text
                        className="font-sora-medium text-xs"
                        style={{ color: selected ? tint : c.mutedForeground }}
                      >
                        {t(`split.mode.${option}`)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View className={cardClass({ padding: 'none' }, 'px-4')}>
              {members.map((m, index) => {
                const included = participants.includes(m.id);
                const share = shares.find((s) => s.memberId === m.id);
                return (
                  <View
                    key={m.id}
                    className={
                      index === 0
                        ? 'flex-row items-center gap-3 py-2.5'
                        : 'flex-row items-center gap-3 border-t border-border py-2.5'
                    }
                  >
                    <Pressable
                      onPress={() => toggle(m.id)}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: included }}
                      accessibilityLabel={memberName(m.id)}
                      hitSlop={6}
                      className="flex-1 flex-row items-center gap-3"
                      style={{ minHeight: 44 }}
                    >
                      <View
                        className="h-5 w-5 items-center justify-center rounded-md border"
                        style={{
                          borderColor: included ? tint : colors[scheme].border,
                          backgroundColor: included ? tint : 'transparent',
                        }}
                      >
                        {included ? <Check size={13} color="#ffffff" strokeWidth={3} /> : null}
                      </View>
                      <MemberAvatars names={[memberName(m.id)]} total={1} size={24} />
                      <View className="flex-1">
                        <Text className="text-foreground" numberOfLines={1}>
                          {memberName(m.id)}
                        </Text>
                        {isFormer(m.id) ? (
                          <Text variant="caption">{t('split.removedMember')}</Text>
                        ) : null}
                      </View>
                    </Pressable>

                    {included && mode === 'exact' ? (
                      <TextInput
                        value={exact[m.id] ?? ''}
                        onChangeText={(v) => setExact((prev) => ({ ...prev, [m.id]: v }))}
                        accessibilityLabel={`${memberName(m.id)} — ${t('split.amount')}`}
                        placeholder="0.00"
                        keyboardType="decimal-pad"
                        placeholderTextColor={colors[scheme].mutedForeground}
                        className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-end text-foreground"
                        style={{ minWidth: 84 }}
                      />
                    ) : (
                      <Text variant="caption">
                        {included && share ? formatMoney(share.shareCents, currency) : '—'}
                      </Text>
                    )}
                  </View>
                );
              })}
            </View>

            {mode === 'exact' && amountCents > 0 ? (
              // The database refuses a split that doesn't sum to the amount, so
              // say so here rather than letting the save bounce off the server.
              <View className="flex-row items-center justify-between">
                <Text
                  variant="caption"
                  style={{ color: remaining === 0 ? c.success : c.warning }}
                  accessibilityLiveRegion="polite"
                >
                  {remaining === 0
                    ? t('split.splitBalanced')
                    : remaining > 0
                      ? t('split.splitRemaining', { amount: formatMoney(remaining, currency) })
                      : t('split.splitOver', { amount: formatMoney(-remaining, currency) })}
                </Text>
                {remaining > 0 ? (
                  <Pressable
                    onPress={spreadRemainder}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={t('split.spreadRemainder')}
                  >
                    <Text className="font-sora-semibold text-xs" style={{ color: tint }}>
                      {t('split.spreadRemainder')}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            ) : participants.length > 0 && amountCents > 0 ? (
              <Text variant="caption" style={{ color: tint }}>
                {t('split.splitSummary', {
                  total: formatMoney(amountCents, currency),
                  count: participants.length,
                })}
              </Text>
            ) : null}
          </View>

          {addExpense.isError || editExpense.isError ? (
            <InlineError error={addExpense.error ?? editExpense.error} />
          ) : null}

          <Button
            label={
              addExpense.isPending || editExpense.isPending ? t('common.saving') : t('common.save')
            }
            onPress={save}
            disabled={!canSave}
            size="lg"
            variant="accent"
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
