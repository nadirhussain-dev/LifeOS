import { formatDistanceToNowStrict } from 'date-fns';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronLeft, Send } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, Pressable, TextInput, View } from 'react-native';
import Animated, { useAnimatedKeyboard, useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/text';
import { moduleTints, resolveTint } from '@/constants/design-tokens';
import { colors } from '@/constants/theme';
import { useAuthStore } from '@/features/auth/services/auth-store';
import { privateModule } from '@/features/private/config/private-modules';
import {
  type DecryptedMessage,
  useAlbumDetail,
  useAlbumKey,
  useAlbumMessages,
  useAlbumRealtime,
  useMyAlbumMembership,
  useSharedAlbumMutations,
} from '@/features/private/hooks/use-shared-albums';
import { usePrivateStore } from '@/features/private/store/private-store';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { alpha } from '@/lib/color';

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
  const { data } = useAlbumDetail(id);
  const { data: albumKey } = useAlbumKey(id);
  const { isOwner } = useMyAlbumMembership(data);
  const {
    data: messages = [],
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useAlbumMessages(id, albumKey ?? null);
  const { sendMessage } = useSharedAlbumMutations(id);

  const [draft, setDraft] = useState('');
  const listRef = useRef<FlatList<DecryptedMessage>>(null);

  const canSend = isOwner || !!data?.album?.allowChat;
  // Newest last from the query; the list itself is inverted, so the visual
  // order still reads oldest-to-newest top-to-bottom with newest at the
  // bottom, and this reversed copy is what "inverted" expects.
  const reversed = [...messages].reverse();

  const send = () => {
    const body = draft.trim();
    if (!body || !albumKey) return;
    sendMessage.mutate({ body, albumKey }, { onSuccess: () => void Haptics.selectionAsync() });
    setDraft('');
  };

  if (!key) return null;
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
          <ChevronLeft size={20} color={theme.foreground} />
        </Pressable>
        <View className="flex-1">
          <Text className="font-sora-extrabold text-2xl tracking-tight" style={{ color: tint }}>
            {t('private.chatTitle')}
          </Text>
          <Text variant="caption">{t('private.chatSubtitle')}</Text>
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
              <Text style={{ color: mine ? '#ffffff' : theme.foreground }}>
                {item.body ?? t('private.commentLocked')}
              </Text>
              <Text
                variant="caption"
                className="mt-0.5"
                style={{ color: mine ? alpha('#ffffff', 0.75) : undefined }}
              >
                {formatDistanceToNowStrict(new Date(item.createdAt), { addSuffix: true })}
              </Text>
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
        <View
          className="flex-row items-center gap-2 border-t border-border px-4 pt-3"
          style={{ paddingBottom: insets.bottom + 10 }}
        >
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={t('private.messagePlaceholder')}
            placeholderTextColor={theme.mutedForeground}
            multiline
            maxLength={1000}
            className="flex-1 rounded-2xl border border-border px-4 py-2.5 text-foreground"
            style={{ maxHeight: 100 }}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('private.postComment')}
            disabled={!draft.trim() || sendMessage.isPending}
            onPress={send}
            className="h-10 w-10 items-center justify-center rounded-full"
            style={{ backgroundColor: alpha(tint, draft.trim() ? 0.95 : 0.35) }}
          >
            <Send size={16} color="#ffffff" />
          </Pressable>
        </View>
      ) : null}
    </Animated.View>
  );
}
