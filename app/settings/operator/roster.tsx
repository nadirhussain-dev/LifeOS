import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { ChevronLeft, Crown, Trash2 } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, TextInput, View } from 'react-native';

import { ListSkeleton } from '@/components/ui/list-skeleton';
import { Button } from '@/components/ui/button';
import { cardClass } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import {
  addOperator,
  isOwner,
  listOperators,
  removeOperator,
  setOperatorRole,
  type Operator,
  type OperatorRole,
} from '@/features/operator/services/operator-repository';
import { useTheme } from '@/hooks/use-theme';
import { confirm, chooseAction } from '@/lib/dialog-store';
import { toast } from '@/lib/toast-store';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The operator roster — owner-only, both to see the mutation controls and
 * to call the RPCs behind them (0033). Listing is open to any operator
 * (`admin_list_operators` only requires `is_staff()`); every button on this
 * screen that changes something re-checks `isOwner()` itself, the same "the
 * server is the boundary, this is a view" discipline the rest of this
 * console follows — a non-owner who somehow reached this screen gets the
 * RPC's own refusal, not a client-side illusion of having done something.
 */
export default function OperatorRosterScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { c } = useTheme();
  const queryClient = useQueryClient();

  const [owner, setOwner] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<OperatorRole>('staff');
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    void isOwner().then(setOwner);
  }, []);

  const roster = useQuery({ queryKey: ['operator', 'roster'], queryFn: listOperators });

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['operator', 'roster'] });

  const add = async () => {
    if (!EMAIL.test(email.trim())) return;
    setBusy('add');
    const result = await addOperator(email.trim(), role);
    setBusy(null);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(t('operator.operatorAdded', { email: email.trim() }));
    setEmail('');
    refresh();
  };

  const openActions = (op: Operator) => {
    const label = op.displayName ?? op.email ?? op.userId;
    void chooseAction({
      title: label,
      actions: [
        { id: 'staff', label: t('operator.makeStaff') },
        { id: 'admin', label: t('operator.makeAdmin') },
        { id: 'remove', label: t('operator.removeOperator'), destructive: true },
      ],
      cancelLabel: t('common.cancel'),
    }).then(async (choice) => {
      if (!choice) return;
      if (choice === 'remove') {
        const ok = await confirm({
          title: t('operator.removeOperatorTitle', { name: label }),
          message: t('operator.removeOperatorBody'),
          confirmLabel: t('common.remove'),
          cancelLabel: t('common.cancel'),
          destructive: true,
        });
        if (!ok) return;
        setBusy(op.userId);
        const result = await removeOperator(op.userId);
        setBusy(null);
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        refresh();
        return;
      }
      setBusy(op.userId);
      const result = await setOperatorRole(op.userId, choice as OperatorRole);
      setBusy(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      refresh();
    });
  };

  return (
    <View className="flex-1 bg-background">
      <View className="flex-row items-center gap-3 px-5 pb-3 pt-14">
        <Pressable
          accessibilityRole="button"
          onPress={() => router.back()}
          hitSlop={10}
          className="h-10 w-10 items-center justify-center rounded-full border border-border bg-surface"
        >
          <ChevronLeft size={20} color={c.foreground} />
        </Pressable>
        <View className="flex-1">
          <Text className="font-sora-extrabold text-xl">{t('operator.operatorsTitle')}</Text>
          <Text variant="caption">{t('operator.operatorsSubtitle')}</Text>
        </View>
      </View>

      <ScrollView contentContainerClassName="gap-6 px-5 pb-10" showsVerticalScrollIndicator={false}>
        <View className={cardClass({ padding: 'none' }, 'px-4')}>
          {roster.isLoading ? <ListSkeleton rows={3} /> : null}
          {(roster.data?.ok ? roster.data.data : []).map((op, index) => {
            const label = op.displayName ?? op.email ?? op.userId;
            return (
              <View
                key={op.userId}
                className={
                  index === 0
                    ? 'flex-row items-center gap-3 py-3.5'
                    : 'flex-row items-center gap-3 border-t border-border py-3.5'
                }
              >
                <View className="flex-1">
                  <View className="flex-row items-center gap-1.5">
                    <Text className="font-sora-medium text-foreground" numberOfLines={1}>
                      {label}
                    </Text>
                    {op.isOwner ? <Crown size={13} color={c.accent} /> : null}
                  </View>
                  <Text variant="caption">
                    {op.isOwner ? t('operator.owner') : t(`operator.role_${op.role}`)}
                  </Text>
                </View>
                {owner && !op.isOwner ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => openActions(op)}
                    disabled={busy === op.userId}
                    hitSlop={8}
                    className="h-10 w-10 items-center justify-center"
                  >
                    <Trash2 size={16} color={c.mutedForeground} />
                  </Pressable>
                ) : null}
              </View>
            );
          })}
        </View>

        {owner ? (
          <View className="gap-3">
            <Text variant="micro">{t('operator.addOperator')}</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="teammate@example.com"
              placeholderTextColor={c.mutedForeground}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              className={cardClass({ padding: 'row' }, 'text-foreground')}
            />
            <View className="flex-row gap-2">
              {(['staff', 'admin'] as OperatorRole[]).map((r) => (
                <Pressable
                  key={r}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: role === r }}
                  onPress={() => setRole(r)}
                  className="flex-1 items-center rounded-2xl border py-2.5"
                  style={{ borderColor: role === r ? c.accent : c.border }}
                >
                  <Text style={{ color: role === r ? c.accent : c.foreground }}>
                    {t(`operator.role_${r}`)}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Button
              label={busy === 'add' ? t('common.saving') : t('operator.addOperator')}
              onPress={() => void add()}
              disabled={!EMAIL.test(email.trim()) || busy !== null}
            />
          </View>
        ) : (
          <Text variant="caption">{t('operator.rosterOwnerOnly')}</Text>
        )}
      </ScrollView>
    </View>
  );
}
