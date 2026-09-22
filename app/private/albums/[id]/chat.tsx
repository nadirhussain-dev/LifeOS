import { formatDistanceToNowStrict } from 'date-fns/formatDistanceToNowStrict';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, Pressable, View } from 'react-native';
import Animated, { useAnimatedKeyboard, useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Mic, Send, Trash2 } from '@/components/ui/icons';
import { Input } from '@/components/ui/input';
import { ChevronBack } from '@/components/ui/directional-icon';
import { QueryError } from '@/components/ui/query-error';
import { ScreenHeader } from '@/components/ui/screen-header';
import { Text } from '@/components/ui/text';
import { moduleTints, resolveTint } from '@/constants/design-tokens';
import { colors } from '@/constants/theme';
import { useAuthStore } from '@/features/auth/services/auth-store';
import { privateModule } from '@/features/private/config/private-modules';
import { MessageTicks } from '@/features/private/components/message-ticks';
import { VoiceMessageBubble } from '@/features/private/components/voice-message-bubble';
import { useAlbumPresence } from '@/features/private/hooks/use-album-presence';
import {
  type DecryptedMessage,
  messageReceipt,
  useAlbumDetail,
  useAlbumKey,
  useAlbumMessages,
  useAlbumRealtime,
  useAlbumReceipts,
  useMyAlbumMembership,
  useSharedAlbumMutations,
} from '@/features/private/hooks/use-shared-albums';
import { useVoiceRecorder } from '@/features/private/hooks/use-voice-recorder';
import { formatVoiceDuration } from '@/features/private/services/voice-notes';
import { usePrivateStore } from '@/features/private/store/private-store';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { alpha } from '@/lib/color';
import { notify } from '@/lib/dialog-store';

const TINT = privateModule('shared-albums')?.tint ?? moduleTints.albums;

/**
 * The album's own chat — reachable only while `allow_chat` is on (or you're
 * the owner), exactly like the comment sheet. A bespoke layout rather than
 * `PrivateScreen`'s shell: an inverted `FlatList` is the one shape a chat
 * actually wants, which the shared shell's plain `ScrollView` isn't built
 * for. The lock redirect `PrivateScreen` normally provides is reproduced
 * below for the same reason every other private screen has it.
 */
export default function AlbumChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme() ?? 'light';
  const theme = colors[scheme];
  const tint = resolveTint(TINT, scheme);
  const { t } = useTranslation();

  // Reads the *live* IME inset (WindowInsets on Android) frame by frame,
  // rather than `KeyboardAvoidingView`'s one-shot height estimate from the
  // Keyboard module's show/hide event. That estimate is what caused the two
  // failed attempts before this: `behavior="height"` did nothing (fights the
  // `flex-1` container for control of this view's size) and `behavior="padding"`
  // used a keyboard-height snapshot that didn't account for Gboard's
  // toolbar row (stickers/GIF/clipboard) expanding a beat after the base
  // keyboard appears, so the padding fell short of — or in a later
  // measurement, overshot — the keyboard's actual settled height, leaving a
  // visible gap either way. `keyboard.height` tracks the real inset
  // continuously, so the padding always matches whatever is actually on
  // screen, animation included.
  const keyboard = useAnimatedKeyboard();
  const keyboardPadding = useAnimatedStyle(() => ({ paddingBottom: keyboard.height.value }));

  const key = usePrivateStore((s) => s.key);
  const space = usePrivateStore((s) => s.space);
  const userId = useAuthStore((s) => s.user?.id ?? null);

  useEffect(() => {
    if (!key) router.replace('/private/unlock');
  }, [key, router]);

  useAlbumRealtime(id);
  const detailQuery = useAlbumDetail(id);
  const { data } = detailQuery;
  const { data: albumKey } = useAlbumKey(id);
  const { isOwner } = useMyAlbumMembership(data);
  const {
    data: messages = [],
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useAlbumMessages(id, albumKey ?? null);
  const { sendMessage, sendVoice, markRead } = useSharedAlbumMutations(id);
  const { data: receipts } = useAlbumReceipts(id);
  const { onlineIds, typingIds, notifyTyping, notifySent } = useAlbumPresence(id);
  const recorder = useVoiceRecorder();

  const [draft, setDraft] = useState('');
  const listRef = useRef<FlatList<DecryptedMessage>>(null);

  const canSend = isOwner || !!data?.album?.allowChat;
  // Newest last from the query; the list itself is inverted, so the visual
  // order still reads oldest-to-newest top-to-bottom with newest at the
  // bottom, and this reversed copy is what "inverted" expects.
  const reversed = [...messages].reverse();

  const newest = messages.length > 0 ? messages[messages.length - 1].createdAt : 0;
  // Being on this screen with the newest message rendered IS having read it —
  // there is no further gesture to wait for in a chat. Keyed on the timestamp
  // so a rerender that changed nothing does not re-report.
  const markReadMutate = markRead.mutate;
  useEffect(() => {
    if (!newest || !canSend) return;
    markReadMutate(newest);
  }, [newest, canSend, markReadMutate]);

  const send = () => {
    const body = draft.trim();
    if (!body || !albumKey) return;
    sendMessage.mutate({ body, albumKey }, { onSuccess: () => void Haptics.selectionAsync() });
    setDraft('');
    notifySent();
  };

  const onDraftChange = (next: string) => {
    setDraft(next);
    if (next.trim()) notifyTyping();
  };

  const startRecording = async () => {
    const ok = await recorder.start();
    if (!ok) {
      void notify({
        title: t('private.voiceNoMicTitle'),
        message: t('private.voiceNoMicBody'),
        confirmLabel: t('common.ok'),
      });
      return;
    }
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  const finishRecording = async () => {
    const result = await recorder.stop();
    if (!result || !albumKey) return;
    void Haptics.selectionAsync();
    sendVoice.mutate(
      { uri: result.uri, durationMs: result.durationMs, albumKey },
      {
        onSuccess: (outcome) => {
          notifySent();
          if (outcome.ok) return;
          // Each of these is a different sentence, which is why the mutation
          // reports a reason rather than a boolean.
          void notify({
            title: t('private.voiceFailedTitle'),
            message: t(`private.voiceFailed_${outcome.reason}`),
            confirmLabel: t('common.ok'),
          });
        },
      },
    );
  };

  // Everyone but me, and only members who have actually joined — a member row
  // that has been invited but never redeemed has no user id and no device, so
  // counting them would hold every message on one tick until they accepted.
  const otherMemberIds = useMemo(
    () =>
      (data?.members ?? [])
        .filter((m) => m.userId && m.userId !== userId && !m.removedAt)
        .map((m) => m.userId as string),
    [data?.members, userId],
  );

  const typingLabel = useMemo(() => {
    if (typingIds.length === 0) return null;
    const names = typingIds.map(
      (uid) => data?.members?.find((m) => m.userId === uid)?.displayName ?? t('moderation.someone'),
    );
    return names.length === 1
      ? t('private.chatTypingOne', { name: names[0] })
      : t('private.chatTypingMany', { count: names.length });
  }, [typingIds, data?.members, t]);

  if (!key) return null;
  // Without the album record there are no members, so no names on messages and
  // no permission to post — a chat that renders as empty and inert rather than
  // as one that could not be reached.
  if (detailQuery.isError) {
    return (
      <View className="flex-1 bg-background">
        <ScreenHeader />
        <QueryError error={detailQuery.error} onRetry={() => detailQuery.refetch()} />
      </View>
    );
  }
  if (space !== 'real') {
    return (
      <View className="flex-1 items-center justify-center bg-background px-6">
        <Text variant="muted">{t('private.albumsRealSpaceOnly')}</Text>
      </View>
    );
  }

  return (
    <Animated.View className="flex-1 bg-background" style={keyboardPadding}>
      <View
        className="flex-row items-center gap-3 px-5 pb-3"
        style={{ paddingTop: insets.top + 8 }}
      >
        <Pressable
          accessibilityRole="button"
          onPress={() => router.back()}
          hitSlop={10}
          className="h-10 w-10 items-center justify-center rounded-full border border-border bg-surface"
        >
          <ChevronBack size={20} color={theme.foreground} />
        </Pressable>
        <View className="flex-1">
          <Text className="font-sora-extrabold text-2xl tracking-tight" style={{ color: tint }}>
            {t('private.chatTitle')}
          </Text>
          {/* Typing outranks presence: somebody typing is necessarily here, so
              showing both would spend a line on the weaker of two facts. */}
          {typingLabel ? (
            <Text variant="caption" style={{ color: tint }}>
              {typingLabel}
            </Text>
          ) : onlineIds.length > 0 ? (
            <View className="flex-row items-center gap-1.5">
              <View
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: '#22c55e' }}
                accessibilityElementsHidden
              />
              <Text variant="caption">{t('private.chatLive')}</Text>
            </View>
          ) : (
            <Text variant="caption">{t('private.chatSubtitle')}</Text>
          )}
        </View>
      </View>

      {!canSend ? (
        <View
          className="mx-5 mb-2 rounded-2xl px-4 py-3"
          style={{ backgroundColor: alpha(tint, 0.1) }}
        >
          <Text variant="caption">{t('private.chatOff')}</Text>
        </View>
      ) : null}

      <FlatList
        ref={listRef}
        data={reversed}
        inverted
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 12, gap: 10 }}
        renderItem={({ item }) => {
          const mine = item.authorId === userId;
          const receipt = mine
            ? messageReceipt(
                item,
                receipts?.reads ?? [],
                receipts?.deliveries ?? [],
                otherMemberIds,
              )
            : null;
          return (
            <View
              className="max-w-[80%] rounded-2xl px-4 py-2.5"
              style={{
                alignSelf: mine ? 'flex-end' : 'flex-start',
                backgroundColor: mine ? tint : alpha(theme.mutedForeground, 0.12),
              }}
            >
              {!mine ? (
                <Text
                  variant="caption"
                  className="mb-0.5 font-sora-semibold"
                  style={{ color: tint }}
                >
                  {item.authorName ?? t('moderation.someone')}
                </Text>
              ) : null}

              {item.kind === 'voice' ? (
                <VoiceMessageBubble
                  messageId={item.id}
                  remotePath={item.voicePath}
                  albumKey={albumKey ?? null}
                  durationMs={item.voiceDurationMs}
                  tint={tint}
                  onLight={mine}
                />
              ) : (
                <Text style={{ color: mine ? '#ffffff' : theme.foreground }}>
                  {item.body ?? t('private.commentLocked')}
                </Text>
              )}

              <View className="mt-0.5 flex-row items-center">
                <Text
                  variant="caption"
                  style={{ color: mine ? alpha('#ffffff', 0.75) : undefined }}
                >
                  {formatDistanceToNowStrict(new Date(item.createdAt), { addSuffix: true })}
                </Text>
                {item.editedAt ? (
                  <Text
                    variant="caption"
                    className="ml-1"
                    style={{ color: mine ? alpha('#ffffff', 0.75) : undefined }}
                  >
                    {t('private.chatEdited')}
                  </Text>
                ) : null}
                {receipt ? (
                  <MessageTicks
                    receipt={receipt}
                    label={t(`private.receipt_${receipt}`)}
                    onLight={mine}
                  />
                ) : null}
              </View>
            </View>
          );
        }}
        ListEmptyComponent={
          <View className="items-center py-16">
            <Text variant="muted">{t('private.noMessagesYet')}</Text>
          </View>
        }
        // The list is inverted, so "end" is visually the top — exactly where
        // older history should load as the user scrolls up toward it.
        onEndReached={() => {
          if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
        }}
        onEndReachedThreshold={0.4}
        ListFooterComponent={
          isFetchingNextPage ? (
            <View className="items-center py-3">
              <ActivityIndicator color={theme.mutedForeground} />
            </View>
          ) : null
        }
      />

      {canSend ? (
        recorder.isRecording ? (
          // A distinct bar rather than a mic that changes colour: recording is
          // the one state in this screen where a mistap is expensive, so the
          // discard control is a labelled target of its own and the send is
          // not where the mic used to be.
          <View
            className="flex-row items-center gap-3 border-t border-border px-4 pt-3"
            style={{ paddingBottom: insets.bottom + 10 }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('private.voiceDiscard')}
              onPress={() => void recorder.cancel()}
              hitSlop={8}
              className="h-10 w-10 items-center justify-center rounded-full"
              style={{ backgroundColor: alpha(theme.mutedForeground, 0.15) }}
            >
              <Trash2 size={16} color={theme.foreground} />
            </Pressable>

            <View className="flex-1 flex-row items-center gap-2">
              <View
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: '#ef4444' }}
                accessibilityElementsHidden
              />
              <Text variant="caption">
                {t('private.voiceRecording', {
                  duration: formatVoiceDuration(recorder.durationMs),
                })}
              </Text>
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('private.voiceSend')}
              onPress={() => void finishRecording()}
              className="h-10 w-10 items-center justify-center rounded-full"
              style={{ backgroundColor: alpha(tint, 0.95) }}
            >
              <Send size={16} color="#ffffff" />
            </Pressable>
          </View>
        ) : (
          <View
            className="flex-row items-center gap-2 border-t border-border px-4 pt-3"
            style={{ paddingBottom: insets.bottom + 10 }}
          >
            <Input
              surface="bare"
              value={draft}
              onChangeText={onDraftChange}
              placeholder={t('private.messagePlaceholder')}
              multiline
              maxLength={1000}
              className="flex-1 rounded-2xl border border-border px-4 py-2.5 text-foreground"
              style={{ maxHeight: 100 }}
            />
            {/* The mic gives way to send once there is something to send —
                two send affordances at once would leave it ambiguous which
                one posts the text that is already typed. */}
            {draft.trim() ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('private.postComment')}
                disabled={sendMessage.isPending}
                onPress={send}
                className="h-10 w-10 items-center justify-center rounded-full"
                style={{ backgroundColor: alpha(tint, 0.95) }}
              >
                <Send size={16} color="#ffffff" />
              </Pressable>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('private.voiceRecord')}
                disabled={sendVoice.isPending}
                onPress={() => void startRecording()}
                className="h-10 w-10 items-center justify-center rounded-full"
                style={{ backgroundColor: alpha(tint, sendVoice.isPending ? 0.35 : 0.95) }}
              >
                {sendVoice.isPending ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <Mic size={16} color="#ffffff" />
                )}
              </Pressable>
            )}
          </View>
        )
      ) : null}
    </Animated.View>
  );
}
