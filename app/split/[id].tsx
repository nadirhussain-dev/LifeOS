import type { BottomSheetModal } from '@gorhom/bottom-sheet';
import { format } from 'date-fns';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Flag, HandCoins, LogOut, Plus, Receipt, Trash2, UserPlus } from 'lucide-react-native';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';

import { cardClass } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { QueryError } from '@/components/ui/query-error';
import { ScreenHeader } from '@/components/ui/screen-header';
import { SectionHeader } from '@/components/ui/section-header';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { moduleTint, colors as dsColors } from '@/constants/design-tokens';
import { colors } from '@/constants/theme';
import { formatMoney } from '@/features/budget/services/money';
import { MemberAvatars } from '@/features/split/components/member-avatars';
import { ReportSheet, type ReportTarget } from '@/features/moderation/components/report-sheet';
import {
  useGroupBalances,
  useGroupDetail,
  useMyMembership,
  useSplitMutations,
} from '@/features/split/hooks/use-split';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { alpha } from '@/lib/color';
import { errorMessageKey } from '@/lib/supabase-error';
import { confirm } from '@/lib/dialog-store';
import { toast } from '@/lib/toast-store';

export default function SplitGroupScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const tint = moduleTint('budget', scheme);
  const c = dsColors[scheme];
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, isError, error, refetch } = useGroupDetail(id);
  const { balances, spendCents, mine } = useGroupBalances(data);
  const { me, isOwner } = useMyMembership(data);

  const reportSheet = useRef<BottomSheetModal>(null);
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);
  const { deleteGroup, removeMember } = useSplitMutations(id);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const currency = data?.group?.currency ?? 'USD';
  const memberOf = (memberId: string) => data?.members.find((x) => x.id === memberId) ?? null;
  const memberName = (memberId: string) => {
    const m = memberOf(memberId);
    return m?.displayName || m?.email || t('split.someone');
  };

  /**
   * Retiring the group is soft, but it is still shared history — everybody
   * else loses it from their list too, so it asks first and says as much.
   */
  const confirmDeleteGroup = () => {
    void confirm({
      title: t('split.deleteGroupTitle', { name: data?.group?.name ?? '' }),
      message: t('split.deleteGroupBody'),
      confirmLabel: t('common.delete'),
      cancelLabel: t('common.cancel'),
      destructive: true,
    }).then(async (ok) => {
      if (!ok) return;
      deleteGroup.mutate(undefined, {
        onSuccess: () => {
          toast.success(t('split.groupDeleted', { name: data?.group?.name ?? '' }));
          router.replace('/split');
        },
        onError: (e) => toast.error(t(errorMessageKey(e))),
      });
    });
  };

  /** Leaving keeps your history in the group — the member row is tombstoned,
   *  never removed, so the balances still add up for everyone left behind. */
  const confirmLeave = () => {
    if (!me) return;
    const settled = (mine?.netCents ?? 0) === 0;
    void confirm({
      title: t('split.leaveTitle'),
      message: settled ? t('split.leaveBody') : t('split.leaveUnsettledBody'),
      confirmLabel: t('split.leave'),
      cancelLabel: t('common.cancel'),
      destructive: true,
    }).then(async (ok) => {
      if (!ok) return;
      removeMember.mutate(me.id, {
        onSuccess: () => {
          toast.success(t('split.leftGroup'));
          router.replace('/split');
        },
        onError: (e) => toast.error(t(errorMessageKey(e))),
      });
    });
  };

  if (isError) {
    return (
      <View className="flex-1 bg-background">
        <ScreenHeader eyebrow={t('split.title')} tint={tint} />
        <QueryError error={error} onRetry={() => refetch()} />
      </View>
    );
  }

  const settled = !mine || mine.netCents === 0;
  const owed = (mine?.netCents ?? 0) > 0;
  const myColor = settled ? colors[scheme].foreground : owed ? c.success : c.error;
  const myStatus = settled
    ? t('split.allSquare')
    : owed
      ? t('split.youAreOwed')
      : t('split.youOwe');

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader
        title={data?.group?.name}
        eyebrow={t('split.title')}
        tint={tint}
        actions={[
          {
            icon: UserPlus,
            label: t('split.addPeople'),
            onPress: () => router.push(`/split/${id}/members`),
          },
          // The group itself is reportable, not only its members: an abusive
          // group name or a group somebody was added to against their will has
          // no single member to name, and "leave" is not a report.
          {
            icon: Flag,
            label: t('moderation.reportMember'),
            onPress: () => {
              setReportTarget({
                reportedUserId: data?.group?.createdBy ?? null,
                surface: 'expense_group',
                surfaceId: id,
                evidence: {
                  groupId: id,
                  groupName: data?.group?.name ?? null,
                },
                label: t('moderation.reportGroupLabel', { name: data?.group?.name ?? '' }),
              });
              reportSheet.current?.present();
            },
          },
          // The owner retires the group; everyone else can only leave it.
          isOwner
            ? {
                icon: Trash2,
                label: t('split.deleteGroup'),
                onPress: confirmDeleteGroup,
                tint: c.error,
              }
            : {
                icon: LogOut,
                label: t('split.leave'),
                onPress: confirmLeave,
                tint: c.error,
              },
        ]}
      />

      {isLoading || !data ? (
        <View className="gap-3 px-5 pt-2">
          <Skeleton className="h-28 w-full rounded-2xl" />
          <Skeleton className="h-20 w-full rounded-2xl" />
        </View>
      ) : (
        <ScrollView
          contentContainerClassName="gap-6 px-5 pb-28 pt-1"
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              // Without a tint the spinner is invisible on the dark ground.
              tintColor={colors[scheme].mutedForeground}
              colors={[tint]}
            />
          }
        >
          {/* Your position first — the question people open this for — with
              total spend beside it. */}
          <View className={cardClass({ padding: 'md' }, 'gap-3')}>
            <View className="flex-row">
              <View
                className="flex-1 gap-0.5"
                accessible
                accessibilityLabel={`${myStatus} ${formatMoney(Math.abs(mine?.netCents ?? 0), currency)}`}
              >
                <Text variant="micro">{t('split.yourPosition')}</Text>
                <Text className="font-sora-extrabold text-2xl" style={{ color: myColor }}>
                  {formatMoney(Math.abs(mine?.netCents ?? 0), currency)}
                </Text>
                <Text variant="caption">{myStatus}</Text>
              </View>
              <View className="w-px bg-border" />
              <View className="flex-1 gap-0.5 ps-4">
                <Text variant="micro">{t('split.totalSpend')}</Text>
                <Text className="font-sora-extrabold text-2xl text-foreground">
                  {formatMoney(spendCents, currency)}
                </Text>
                <Text variant="caption">
                  {t('split.membersCount', { count: data.activeMembers.length })}
                </Text>
              </View>
            </View>

            <View className="flex-row gap-2.5">
              <Pressable
                onPress={() => router.push(`/split/${id}/expense`)}
                accessibilityRole="button"
                accessibilityLabel={t('split.addExpense')}
                className="flex-1 flex-row items-center justify-center gap-2 rounded-xl py-3"
                style={{ backgroundColor: alpha(tint, 0.12) }}
              >
                <Plus size={16} color={tint} />
                <Text className="font-sora-semibold" style={{ color: tint }}>
                  {t('split.addExpense')}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => router.push(`/split/${id}/settle`)}
                accessibilityRole="button"
                accessibilityLabel={t('split.settleUp')}
                className="flex-1 flex-row items-center justify-center gap-2 rounded-xl border border-border py-3"
              >
                <HandCoins size={16} color={colors[scheme].foreground} />
                <Text className="font-sora-semibold text-foreground">{t('split.settleUp')}</Text>
              </Pressable>
            </View>
          </View>

          {/* Who owes what */}
          <View className="gap-2">
            <SectionHeader title={t('split.balances')} />
            <View className={cardClass({ padding: 'none' }, 'px-4')}>
              {balances.map((b, index) => {
                const name = memberName(b.memberId);
                const removed = memberOf(b.memberId)?.removedAt !== null;
                const isSettled = b.netCents === 0;
                const isOwed = b.netCents > 0;
                // Somebody who has left but is still owed money has to stay
                // visible, or the column silently stops adding up.
                if (removed && isSettled) return null;
                return (
                  <View
                    key={b.memberId}
                    accessible
                    accessibilityLabel={
                      isSettled
                        ? `${name}: ${t('split.settled')}`
                        : `${name}: ${isOwed ? t('split.youAreOwed') : t('split.youOwe')} ${formatMoney(Math.abs(b.netCents), currency)}`
                    }
                    className={
                      index === 0
                        ? 'flex-row items-center gap-3 py-3'
                        : 'flex-row items-center gap-3 border-t border-border py-3'
                    }
                  >
                    <MemberAvatars names={[name]} total={1} size={28} />
                    <View className="flex-1">
                      <Text className="text-foreground" numberOfLines={1}>
                        {name}
                      </Text>
                      {removed ? <Text variant="caption">{t('split.removedMember')}</Text> : null}
                    </View>
                    <Text
                      className="font-sora-semibold"
                      style={{
                        color: isSettled
                          ? colors[scheme].mutedForeground
                          : isOwed
                            ? c.success
                            : c.error,
                      }}
                    >
                      {isSettled ? t('split.settled') : formatMoney(Math.abs(b.netCents), currency)}
                    </Text>
                  </View>
                );
              })}
            </View>
          </View>

          {/* Expenses */}
          <View className="gap-2">
            <SectionHeader title={t('split.expenses')} />
            {data.expenses.length === 0 ? (
              <View style={{ minHeight: 160 }}>
                <EmptyState
                  icon={Receipt}
                  title={t('split.noExpensesTitle')}
                  description={t('split.noExpensesBody')}
                  tint={tint}
                  actionLabel={t('split.addExpense')}
                  onAction={() => router.push(`/split/${id}/expense`)}
                />
              </View>
            ) : (
              <View className={cardClass({ padding: 'none' }, 'px-4')}>
                {data.expenses.map((expense, index) => {
                  const payer = memberName(expense.paidByMemberId);
                  const money = formatMoney(expense.amountCents, currency);
                  return (
                    <Pressable
                      key={expense.id}
                      onPress={() => router.push(`/split/${id}/expense?expense=${expense.id}`)}
                      accessibilityRole="button"
                      accessibilityLabel={`${expense.description}, ${money}, ${t('split.paidBy', { name: payer })}, ${format(expense.spentAt, 'PPP')}`}
                      className={
                        index === 0
                          ? 'flex-row items-center gap-3 py-3'
                          : 'flex-row items-center gap-3 border-t border-border py-3'
                      }
                    >
                      <View className="flex-1 gap-0.5">
                        <Text className="font-sora-medium text-foreground" numberOfLines={1}>
                          {expense.description}
                        </Text>
                        <Text variant="caption">
                          {t('split.paidBy', { name: payer })} · {format(expense.spentAt, 'MMM d')}
                        </Text>
                      </View>
                      <Text className="font-sora-semibold text-foreground">{money}</Text>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </View>

          {/* Activity — who did what, which is what makes "anyone can edit" safe */}
          {data.activity.length > 0 && (
            <View className="gap-2">
              <SectionHeader title={t('split.activity')} />
              <View className="gap-2.5">
                {data.activity.slice(0, 12).map((entry) => (
                  <View key={entry.id} className="flex-row items-baseline gap-2">
                    <Text variant="caption" className="flex-1">
                      {t(`split.action.${entry.action}`, {
                        actor: entry.actorName ?? t('split.someone'),
                        description: String(entry.meta?.description ?? ''),
                        // member_added / member_removed / group_deleted record
                        // the subject's name rather than a description.
                        name: String(entry.meta?.name ?? t('split.someone')),
                      })}
                    </Text>
                    <Text variant="caption">{format(entry.createdAt, 'MMM d')}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}
        </ScrollView>
      )}

      <ReportSheet ref={reportSheet} target={reportTarget} />
    </View>
  );
}
