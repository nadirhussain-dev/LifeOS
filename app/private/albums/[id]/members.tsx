import type { BottomSheetModal } from '@gorhom/bottom-sheet';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  Flag,
  KeyRound,
  Mail,
  MessageCircle,
  MessagesSquare,
  Send,
  Trash2,
} from 'lucide-react-native';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Switch, TextInput, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { cardClass } from '@/components/ui/card';
import { InlineError } from '@/components/ui/query-error';
import { Text } from '@/components/ui/text';
import { moduleTints, resolveTint } from '@/constants/design-tokens';
import { colors } from '@/constants/theme';
import { useAuthStore } from '@/features/auth/services/auth-store';
import { FREE_ALBUM_MEMBER_LIMIT } from '@/features/billing/config/plans';
import { usePlan } from '@/features/billing/hooks/use-billing';
import { ReportSheet, type ReportTarget } from '@/features/moderation/components/report-sheet';
import { useBlockMutations } from '@/features/moderation/hooks/use-blocks';
import { PrivateScreen } from '@/features/private/components/private-screen';
import { privateModule } from '@/features/private/config/private-modules';
import {
  useAlbumDetail,
  useAlbumKey,
  useMyAlbumMembership,
  useSharedAlbumMutations,
} from '@/features/private/hooks/use-shared-albums';
import { MemberAvatars } from '@/features/split/components/member-avatars';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { chooseAction, confirm } from '@/lib/dialog-store';
import { toast } from '@/lib/toast-store';

const TINT = privateModule('shared-albums')?.tint ?? moduleTints.albums;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** 0032's trigger message for a free-plan album already at its member cap —
 *  matched the same way album-uploader.ts matches "quota" for photos. */
const MEMBER_LIMIT_PATTERN = /free plan allows two people/i;

/**
 * Album members.
 *
 * Mirrors app/split/[id]/members.tsx's shape closely — add by email, report
 * or block a member, remove one — with one addition that Split never needed:
 * a key-confirmation status, since joining the Postgres membership and
 * redeeming the album's key are two independent steps (see migration 0027's
 * header and album-invite.ts). The owner's row never shows "waiting" — they
 * hold the key from the moment they create the album.
 */
export default function SharedAlbumMembersScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const theme = colors[scheme];
  const tint = resolveTint(TINT, scheme);
  const { t } = useTranslation();

  const { data } = useAlbumDetail(id);
  const { data: albumKey } = useAlbumKey(id);
  const { isOwner } = useMyAlbumMembership(data);
  const { addMember, removeMember, setPermissions } = useSharedAlbumMutations(id);
  const myUserId = useAuthStore((s) => s.user?.id ?? null);
  const { isPlus } = usePlan();

  const reportSheet = useRef<BottomSheetModal>(null);
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);
  const { block } = useBlockMutations();

  const [email, setEmail] = useState('');
  const emailValid = EMAIL.test(email.trim());

  const members = data?.activeMembers ?? [];
  // Governed by the OWNER's plan (0032) — this screen only knows that
  // precisely when the viewer IS the owner, which is also the common case
  // for who's doing the inviting. A non-owner member on someone else's
  // free-plan album still gets the server's rejection via the onError
  // pattern-match below, just without the pre-emptive upsell.
  const atFreeMemberLimit = isOwner && !isPlus && members.length >= FREE_ALBUM_MEMBER_LIMIT;
  const canAdd = emailValid && !addMember.isPending && !atFreeMemberLimit;

  const add = () => {
    if (!canAdd) return;
    const label = email.trim();
    addMember.mutate(
      { email: label, displayName: null },
      {
        onSuccess: () => {
          toast.success(t('private.memberAdded', { name: label }));
          setEmail('');
        },
        onError: (error) => {
          if (MEMBER_LIMIT_PATTERN.test(error instanceof Error ? error.message : '')) {
            toast.error(t('billing.memberLimitToast'));
          }
        },
      },
    );
  };

  const seePlans = () => router.push('/settings/media');

  const openReport = (member: { id: string; userId: string | null }, label: string) => {
    setReportTarget({
      reportedUserId: member.userId,
      surface: 'shared_space',
      surfaceId: id ?? null,
      // One item: who, in which album — not the photo list, per
      // report-sheet.tsx's own discipline about keeping evidence to one item.
      evidence: { memberId: member.id, memberLabel: label, albumId: id },
      label,
    });
    reportSheet.current?.present();
  };

  const applyBlock = (userId: string, label: string) =>
    block.mutate(userId, {
      onSuccess: (result) =>
        result.ok
          ? toast.success(t('moderation.blocked', { name: label }))
          : toast.error(t('errors.unknown')),
    });

  const openMemberActions = (member: { id: string; userId: string | null }, label: string) => {
    if (member.userId === null) {
      openReport(member, label);
      return;
    }
    const userId = member.userId;
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

  /**
   * Removal is honest about what it does and does not do: it stops the
   * member fetching anything new immediately, and it says plainly that it
   * cannot undo what they already saw — see migration 0027's header and
   * TODO.md's own flag for shared spaces.
   */
  const confirmRemove = (memberId: string, label: string) =>
    void confirm({
      title: t('private.removeMemberTitle', { name: label }),
      message: t('private.removeMemberBody'),
      confirmLabel: t('common.remove'),
      cancelLabel: t('common.cancel'),
      destructive: true,
    }).then((ok) => {
      if (!ok) return;
      removeMember.mutate(memberId, {
        onSuccess: () => toast.success(t('common.remove')),
      });
    });

  return (
    <PrivateScreen moduleId="shared-albums" title={t('private.members')} tint={tint}>
      <View className={cardClass({ padding: 'none' }, 'px-4')}>
        {members.map((member, index) => {
          const label = member.displayName || member.email || t('split.someone');
          const pending = member.userId === null;
          const waitingOnKey = !pending && member.role !== 'owner' && !member.keyConfirmedAt;
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
                      : waitingOnKey
                        ? t('private.waitingOnKey')
                        : t('private.keyConfirmedLabel')}
                </Text>
              </View>
              {pending && member.email ? (
                <Pressable
                  onPress={() => router.push(`/private/albums/${id}/invite?memberId=${member.id}`)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`${t('private.generateInvite')}: ${label}`}
                  className="h-11 w-11 items-center justify-center"
                >
                  <Send size={16} color={tint} />
                </Pressable>
              ) : null}
              {!pending && waitingOnKey && albumKey ? (
                <Pressable
                  onPress={() => router.push(`/private/albums/${id}/invite?memberId=${member.id}`)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`${t('private.resendKey')}: ${label}`}
                  className="h-11 w-11 items-center justify-center"
                >
                  <KeyRound size={16} color={tint} />
                </Pressable>
              ) : null}
              {member.userId !== myUserId ? (
                <Pressable
                  onPress={() => openMemberActions(member, label)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`${t('moderation.reportMember')}: ${label}`}
                  className="h-11 w-11 items-center justify-center"
                >
                  <Flag size={16} color={theme.mutedForeground} />
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
                  <Trash2 size={17} color={theme.mutedForeground} />
                </Pressable>
              ) : null}
            </View>
          );
        })}
      </View>

      {/*
        Owner-only, both to see and to touch — migration 0029's trigger is
        the enforcement, this just doesn't offer a control that would fail.
        Off by default for a reason: comments and chat are a bigger surface
        for something unwanted to be said than "who's allowed to add a
        photo", so this stays an explicit choice rather than a default.
      */}
      {isOwner ? (
        <View className="gap-3">
          <Text variant="caption" className="font-sora-semibold uppercase tracking-wide">
            {t('private.together')}
          </Text>
          <View className={cardClass({ padding: 'none' }, 'px-4')}>
            <View className="flex-row items-center gap-3 py-3.5">
              <MessageCircle size={17} color={theme.mutedForeground} />
              <View className="flex-1">
                <Text className="font-sora-medium text-foreground">
                  {t('private.allowComments')}
                </Text>
                <Text variant="caption">{t('private.allowCommentsHint')}</Text>
              </View>
              <Switch
                value={!!data?.album?.allowComments}
                onValueChange={(next) => setPermissions.mutate({ allowComments: next })}
                trackColor={{ true: tint, false: theme.border }}
              />
            </View>
            <View className="flex-row items-center gap-3 border-t border-border py-3.5">
              <MessagesSquare size={17} color={theme.mutedForeground} />
              <View className="flex-1">
                <Text className="font-sora-medium text-foreground">{t('private.allowChat')}</Text>
                <Text variant="caption">{t('private.allowChatHint')}</Text>
              </View>
              <Switch
                value={!!data?.album?.allowChat}
                onValueChange={(next) => setPermissions.mutate({ allowChat: next })}
                trackColor={{ true: tint, false: theme.border }}
              />
            </View>
          </View>
        </View>
      ) : null}

      <View className="gap-3">
        <Text variant="caption" className="font-sora-semibold uppercase tracking-wide">
          {t('private.addMemberStep')}
        </Text>

        {atFreeMemberLimit ? (
          <View className={cardClass({ padding: 'rowLg' }, 'gap-2')}>
            <Text className="font-sora-medium text-foreground">
              {t('billing.memberLimitTitle')}
            </Text>
            <Text variant="caption">
              {t('billing.memberLimitBody', { count: FREE_ALBUM_MEMBER_LIMIT })}
            </Text>
            <Button
              label={t('billing.seePlans')}
              onPress={seePlans}
              variant="accent"
              style={{ backgroundColor: tint }}
            />
          </View>
        ) : (
          <>
            <View className={cardClass({ padding: 'row' }, 'flex-row items-center gap-2')}>
              <Mail size={16} color={theme.mutedForeground} />
              <TextInput
                value={email}
                onChangeText={setEmail}
                accessibilityLabel={t('auth.email')}
                placeholder="friend@example.com"
                placeholderTextColor={theme.mutedForeground}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="done"
                onSubmitEditing={add}
                className="flex-1 text-foreground"
              />
            </View>

            {addMember.isError ? <InlineError error={addMember.error} /> : null}

            <Button
              label={addMember.isPending ? t('common.saving') : t('private.invite')}
              onPress={add}
              disabled={!canAdd}
              variant="accent"
              style={{ backgroundColor: tint }}
            />
          </>
        )}
      </View>

      <ReportSheet
        ref={reportSheet}
        target={reportTarget}
        onBlock={(userId) => {
          const label = reportTarget?.label ?? t('moderation.someone');
          void confirm({
            title: t('moderation.blockAfterReport'),
            message: t('moderation.blockAfterReportBody'),
            confirmLabel: t('moderation.block'),
            cancelLabel: t('moderation.notNow'),
            destructive: true,
          }).then((ok) => {
            if (ok) applyBlock(userId, label);
          });
        }}
      />
    </PrivateScreen>
  );
}
