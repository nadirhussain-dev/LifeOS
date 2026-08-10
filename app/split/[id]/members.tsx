import type { BottomSheetModal } from '@gorhom/bottom-sheet';
import { useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Flag, Mail, Send, Trash2, UserPlus } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Share,
  TextInput,
  View,
} from 'react-native';

import { cardClass } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { InlineError } from '@/components/ui/query-error';
import { SheetHeader } from '@/components/ui/sheet-header';
import { Text } from '@/components/ui/text';
import { moduleTint } from '@/constants/design-tokens';
import { colors } from '@/constants/theme';
import { MemberAvatars } from '@/features/split/components/member-avatars';
import { formatMoney } from '@/features/budget/services/money';
import { ReportSheet, type ReportTarget } from '@/features/moderation/components/report-sheet';
import { useBlockMutations } from '@/features/moderation/hooks/use-blocks';
import {
  useGroupBalances,
  useGroupDetail,
  useMyMembership,
  useSplitMutations,
} from '@/features/split/hooks/use-split';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { errorKind } from '@/lib/supabase-error';
import { chooseAction, confirm } from '@/lib/dialog-store';
import { toast } from '@/lib/toast-store';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Group members.
 *
 * Somebody added by email becomes a member immediately and can be split with
 * straight away — their user_id is filled in when they accept the invitation.
 * Until then they are a placeholder: real, splittable, but not yet notified.
 */
export default function SplitMembersScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const tint = moduleTint('budget', scheme);

  const { data } = useGroupDetail(id);
  const { balances } = useGroupBalances(data);
  const { me, isOwner } = useMyMembership(data);
  const myUserId = me?.userId ?? null;
  const { addMember, invite, removeMember } = useSplitMutations(id);

  const [email, setEmail] = useState('');
  const [name, setName] = useState('');

  const reportSheet = useRef<BottomSheetModal>(null);
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);
  const { block } = useBlockMutations();

  const emailValid = EMAIL.test(email.trim());
  const canAdd = emailValid && !addMember.isPending;
  // Removed members are kept in the group's data so the ledger still balances
  // (see migration 0008); they are listed separately rather than mixed in.
  const members = data?.activeMembers ?? [];
  const removed = (data?.members ?? []).filter((m) => m.removedAt !== null);
  const currency = data?.group?.currency ?? '$';
  const netOf = (memberId: string) => balances.find((b) => b.memberId === memberId)?.netCents ?? 0;

  const add = () => {
    if (!canAdd) return;
    addMember.mutate(
      { email: email.trim(), displayName: name.trim() || null },
      {
        // Confirmation belongs after the write, not on the tap that starts it.
        onSuccess: () => {
          toast.success(t('split.memberAdded', { name: name.trim() || email.trim() }));
          setEmail('');
          setName('');
        },
        onError: () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
      },
    );
  };

  /**
   * Sends (or re-sends) the invitation. If email isn't configured the function
   * still returns a real, redeemable link — so hand it to the share sheet rather
   * than pretending an email went out.
   */
  const sendInvite = (memberId: string, memberEmail: string) => {
    invite.mutate(
      { memberId, email: memberEmail, groupName: data?.group?.name ?? '' },
      {
        onSuccess: async ({ link, emailed }) => {
          if (emailed) {
            // Was an Alert: a modal that stops everything to report something
            // the user just asked for and already expects.
            toast.success(t('split.inviteSentBody', { email: memberEmail }));
            return;
          }
          await Share.share({ message: t('split.inviteShareMessage', { link }) });
        },
        onError: (error) => toast.error(t(`errors.${errorKind(error)}`)),
      },
    );
  };

  /**
   * Removing somebody is visible to everyone else in the group, so this keeps
   * its confirmation rather than becoming an undoable toast.
   *
   * The removal is a tombstone: their expenses, their shares and everything
   * they are owed stay in the ledger, and they keep appearing in the balances
   * until they are settled up. Saying so matters — "remove" reads like
   * "erase", and somebody owed money would reasonably fear losing it.
   */
  const confirmRemove = (memberId: string, label: string) => {
    const net = netOf(memberId);
    const body =
      net === 0
        ? t('split.removeMemberBody', { name: label })
        : t('split.removeMemberUnsettledBody', {
            name: label,
            amount: formatMoney(Math.abs(net), currency),
          });

    void confirm({
      title: t('split.removeMemberTitle'),
      message: body,
      confirmLabel: t('common.remove'),
      cancelLabel: t('common.cancel'),
      destructive: true,
    }).then(async (ok) => {
      if (!ok) return;
      removeMember.mutate(memberId, {
        onSuccess: () => toast.success(t('split.memberRemoved', { name: label })),
        onError: (error) => toast.error(t(`errors.${errorKind(error)}`)),
      });
    });
  };

  const applyBlock = (userId: string, label: string) =>
    block.mutate(userId, {
      onSuccess: (result) =>
        result.ok
          ? toast.success(t('moderation.blocked', { name: label }))
          : toast.error(
              t(`errors.${result.error === 'not-configured' ? 'not-configured' : 'unknown'}`),
            ),
      onError: (error) => toast.error(t(`errors.${errorKind(error)}`)),
    });

  const openReport = (member: { id: string; userId: string | null }, label: string) => {
    setReportTarget({
      reportedUserId: member.userId,
      surface: 'expense_group',
      surfaceId: id,
      // One item: who, in which group. Deliberately not the expense list — a
      // report that carries the whole group is a way to exfiltrate it by
      // complaining about one line.
      evidence: { memberId: member.id, memberLabel: label, groupName: data?.group?.name ?? null },
      label,
    });
    reportSheet.current?.present();
  };

  /**
   * Report and block, on the member row.
   *
   * On the row rather than behind a long-press: a gesture nobody discovers is
   * the same as not having the feature, and this is the screen where you are
   * looking at the person you have a problem with. Blocking is reachable
   * without reporting first — they are different decisions, and requiring a
   * report to get to the block means filing one you did not mean.
   *
   * Somebody invited by email who has not joined has no account yet, so only
   * the report is offered: blocking an email address would be a promise the
   * server cannot keep, since the block is between two auth users.
   */
  const openMemberActions = (member: { id: string; userId: string | null }, label: string) => {
    if (member.userId === null) {
      openReport(member, label);
      return;
    }
    const userId = member.userId;
    // A real menu rather than a three-button alert. Android's native dialog
    // caps at three and drops the rest silently, which is what pushed this
    // into that shape; chooseAction has no such ceiling, so adding a fourth
    // action here later will not quietly lose one.
    void chooseAction({
      title: label,
      actions: [
        { id: 'report', label: t('moderation.reportMember') },
        { id: 'block', label: t('moderation.block'), destructive: true },
      ],
      cancelLabel: t('common.cancel'),
    }).then(async (choice) => {
      if (choice === 'report') {
        openReport(member, label);
        return;
      }
      if (choice !== 'block') return;
      const ok = await confirm({
        title: t('moderation.blockTitle', { name: label }),
        message: t('moderation.blockBody'),
        confirmLabel: t('moderation.block'),
        cancelLabel: t('common.cancel'),
        destructive: true,
      });
      if (ok) applyBlock(userId, label);
    });
  };

  return (
    <View className="flex-1 bg-background">
      <SheetHeader title={t('split.people')} />

      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerClassName="gap-6 px-5 pt-3 pb-10"
          keyboardShouldPersistTaps="handled"
        >
          <View className={cardClass({ padding: 'none' }, 'px-4')}>
            {members.map((member, index) => {
              const label = member.displayName || member.email || t('split.someone');
              const pending = member.userId === null;
              return (
                <View
                  key={member.id}
                  className={
                    index === 0
                      ? 'flex-row items-center gap-3 py-3'
                      : 'flex-row items-center gap-3 border-t border-border py-3'
                  }
                >
                  <MemberAvatars names={[label]} total={1} size={32} />
                  <View className="flex-1 gap-0.5">
                    <Text className="font-sora-medium text-foreground" numberOfLines={1}>
                      {label}
                    </Text>
                    <Text variant="caption" numberOfLines={1}>
                      {member.role === 'owner'
                        ? t('split.owner')
                        : pending
                          ? t('split.pendingInvite')
                          : (member.email ?? '')}
                    </Text>
                  </View>
                  {pending && member.email ? (
                    <Pressable
                      onPress={() => sendInvite(member.id, member.email!)}
                      hitSlop={8}
                      disabled={invite.isPending}
                      accessibilityRole="button"
                      accessibilityState={{ disabled: invite.isPending }}
                      accessibilityLabel={`${t('split.sendInvite')}: ${label}`}
                      className="h-11 w-11 items-center justify-center"
                    >
                      <Send size={16} color={tint} />
                    </Pressable>
                  ) : null}
                  {/* Not on your own row: reporting yourself is refused
                      server-side (0013) and offering it reads as a bug. */}
                  {member.userId !== myUserId ? (
                    <Pressable
                      onPress={() => openMemberActions(member, label)}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel={`${t('moderation.reportMember')}: ${label}`}
                      className="h-11 w-11 items-center justify-center"
                    >
                      <Flag size={16} color={colors[scheme].mutedForeground} />
                    </Pressable>
                  ) : null}
                  {member.role !== 'owner' && isOwner ? (
                    <Pressable
                      onPress={() => confirmRemove(member.id, label)}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel={`${t('common.remove')}: ${label}`}
                      className="h-11 w-11 items-center justify-center"
                    >
                      <Trash2 size={17} color={colors[scheme].mutedForeground} />
                    </Pressable>
                  ) : null}
                </View>
              );
            })}
          </View>

          {removed.length > 0 ? (
            <View className="gap-2">
              <Text variant="caption" className="font-sora-semibold uppercase tracking-wide">
                {t('split.formerMembers')}
              </Text>
              <View className={cardClass({ padding: 'none' }, 'px-4')}>
                {removed.map((member, index) => {
                  const label = member.displayName || member.email || t('split.someone');
                  const net = netOf(member.id);
                  return (
                    <View
                      key={member.id}
                      className={
                        index === 0
                          ? 'flex-row items-center gap-3 py-3'
                          : 'flex-row items-center gap-3 border-t border-border py-3'
                      }
                    >
                      <View style={{ opacity: 0.55 }}>
                        <MemberAvatars names={[label]} total={1} size={32} />
                      </View>
                      <View className="flex-1 gap-0.5">
                        <Text className="font-sora-medium text-foreground" numberOfLines={1}>
                          {label}
                        </Text>
                        <Text variant="caption">
                          {net === 0
                            ? t('split.removedSettled')
                            : t('split.removedOutstanding', {
                                amount: formatMoney(Math.abs(net), currency),
                              })}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>
              {/* The reason the rows above still exist. */}
              <Text variant="caption">{t('split.formerMembersHint')}</Text>
            </View>
          ) : null}

          <View className="gap-3">
            <Text variant="caption" className="font-sora-semibold uppercase tracking-wide">
              {t('split.addPeople')}
            </Text>

            <View className={cardClass({ padding: 'row' }, 'flex-row items-center gap-2')}>
              <Mail size={16} color={colors[scheme].mutedForeground} />
              <TextInput
                value={email}
                onChangeText={setEmail}
                accessibilityLabel={t('auth.email')}
                placeholder="friend@example.com"
                placeholderTextColor={colors[scheme].mutedForeground}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
                className="flex-1 text-foreground"
              />
            </View>

            <View className={cardClass({ padding: 'row' }, 'flex-row items-center gap-2')}>
              <UserPlus size={16} color={colors[scheme].mutedForeground} />
              <TextInput
                value={name}
                onChangeText={setName}
                accessibilityLabel={t('split.theirName')}
                placeholder={t('split.theirNamePlaceholder')}
                placeholderTextColor={colors[scheme].mutedForeground}
                returnKeyType="done"
                onSubmitEditing={add}
                className="flex-1 text-foreground"
              />
            </View>

            <Text variant="caption">{t('split.inviteHint')}</Text>

            {/* "That person is already in this group" was shown for every
                failure, including offline and permission ones. Now it is shown
                only for the constraint violation that actually means it. */}
            {addMember.isError ? (
              <InlineError
                error={addMember.error}
                message={
                  errorKind(addMember.error) === 'conflict' ? t('split.memberExists') : undefined
                }
              />
            ) : null}

            <Button
              label={addMember.isPending ? t('common.saving') : t('split.addPerson')}
              onPress={add}
              disabled={!canAdd}
              variant="accent"
              style={{ backgroundColor: tint }}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <ReportSheet
        ref={reportSheet}
        target={reportTarget}
        // Offered straight after a report goes in, because that is when
        // somebody knows they want it. Still a separate decision — reporting
        // spam is not the same as never hearing from someone again.
        onBlock={(userId) => {
          const label = reportTarget?.label ?? t('moderation.someone');
          void confirm({
            title: t('moderation.blockAfterReport'),
            message: t('moderation.blockAfterReportBody'),
            confirmLabel: t('moderation.block'),
            cancelLabel: t('moderation.notNow'),
            destructive: true,
          }).then(async (ok) => {
            if (!ok) return;
            applyBlock(userId, label);
          });
        }}
      />
    </View>
  );
}
