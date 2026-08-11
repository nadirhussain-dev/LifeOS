import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetTextInput,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import { formatDistanceToNowStrict } from 'date-fns';
import * as Haptics from 'expo-haptics';
import { Send, Trash2 } from 'lucide-react-native';
import { forwardRef, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { colors } from '@/constants/theme';
import { useAuthStore } from '@/features/auth/services/auth-store';
import { useAlbumComments } from '@/features/private/hooks/use-shared-albums';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { alpha } from '@/lib/color';

export type CommentSheetTarget = {
  photoId: string;
  albumKey: Uint8Array;
  /** allow_comments (0029) OR this account is the album owner — moderators
   *  may always compose, same as the delete permission below. */
  canCompose: boolean;
  isOwner: boolean;
};

type Mutations = {
  addComment: {
    mutate: (
      input: { photoId: string; body: string; albumKey: Uint8Array },
      opts?: { onSuccess?: () => void },
    ) => void;
    isPending: boolean;
  };
  removeComment: { mutate: (input: { commentId: string; photoId: string }) => void };
};

type Props = {
  target: CommentSheetTarget | null;
  tint: string;
  mutations: Mutations;
};

/**
 * A photo's comment thread, in a sheet — mirrors ReportSheet's shape
 * (forwardRef to a BottomSheetModal, one target prop the caller swaps out).
 *
 * `canCompose` is a UX convenience, not the enforcement: migration 0029's
 * `album_allows_comments()` check on the insert policy is what actually
 * stops a write when comments are off, this only avoids showing a box that
 * would fail.
 */
export const AlbumCommentSheet = forwardRef<BottomSheetModal, Props>(function AlbumCommentSheet(
  { target, tint, mutations },
  ref,
) {
  const scheme = useColorScheme() ?? 'light';
  const theme = colors[scheme];
  const { t } = useTranslation();
  const userId = useAuthStore((s) => s.user?.id ?? null);

  const [draft, setDraft] = useState('');
  const { data: comments = [] } = useAlbumComments(target?.photoId, target?.albumKey ?? null);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} opacity={0.4} />
    ),
    [],
  );

  const send = () => {
    const body = draft.trim();
    if (!body || !target) return;
    mutations.addComment.mutate(
      { photoId: target.photoId, body, albumKey: target.albumKey },
      { onSuccess: () => void Haptics.selectionAsync() },
    );
    setDraft('');
  };

  return (
    <BottomSheetModal
      ref={ref}
      enableDynamicSizing
      snapPoints={undefined}
      backdropComponent={renderBackdrop}
      backgroundStyle={{ backgroundColor: theme.card }}
      handleIndicatorStyle={{ backgroundColor: theme.border }}
    >
      <BottomSheetScrollView contentContainerClassName="gap-3 px-5 pb-6 pt-2">
        <Text variant="subheading">{t('private.comments')}</Text>

        {comments.length === 0 ? (
          <Text variant="caption" className="py-4 text-center">
            {t('private.noCommentsYet')}
          </Text>
        ) : (
          comments.map((c) => {
            const mine = c.authorId === userId;
            return (
              <View key={c.id} className="flex-row items-start gap-2.5">
                <View
                  className="h-8 w-8 items-center justify-center rounded-full"
                  style={{ backgroundColor: alpha(tint, 0.16) }}
                >
                  <Text className="font-sora-semibold text-xs" style={{ color: tint }}>
                    {(c.authorName ?? '?').slice(0, 1).toUpperCase()}
                  </Text>
                </View>
                <View className="flex-1 gap-0.5">
                  <View className="flex-row items-center gap-2">
                    <Text className="font-sora-medium text-sm text-foreground">
                      {c.authorName ?? t('moderation.someone')}
                    </Text>
                    <Text variant="caption">
                      {formatDistanceToNowStrict(new Date(c.createdAt), { addSuffix: true })}
                    </Text>
                  </View>
                  <Text className="text-foreground">{c.body ?? t('private.commentLocked')}</Text>
                </View>
                {mine || target?.isOwner ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('common.delete')}
                    hitSlop={8}
                    onPress={() =>
                      target &&
                      mutations.removeComment.mutate({ commentId: c.id, photoId: target.photoId })
                    }
                  >
                    <Trash2 size={14} color={theme.mutedForeground} />
                  </Pressable>
                ) : null}
              </View>
            );
          })
        )}

        {target?.canCompose ? (
          <View className="mt-2 flex-row items-center gap-2 rounded-2xl border border-border px-3 py-2">
            <BottomSheetTextInput
              value={draft}
              onChangeText={setDraft}
              placeholder={t('private.addComment')}
              placeholderTextColor={theme.mutedForeground}
              multiline
              maxLength={500}
              style={{ flex: 1, color: theme.foreground, maxHeight: 90 }}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('private.postComment')}
              disabled={!draft.trim() || mutations.addComment.isPending}
              onPress={send}
              className="h-9 w-9 items-center justify-center rounded-full"
              style={{ backgroundColor: alpha(tint, draft.trim() ? 0.9 : 0.3) }}
            >
              <Send size={15} color="#ffffff" />
            </Pressable>
          </View>
        ) : (
          <Text variant="caption" className="pt-1 text-center">
            {t('private.commentsOff')}
          </Text>
        )}
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
});
