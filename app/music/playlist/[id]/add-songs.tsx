import { FlashList } from '@shopify/flash-list';
import * as Haptics from 'expo-haptics';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/ui/empty-state';
import { QueryError } from '@/components/ui/query-error';
import { ScreenHeader } from '@/components/ui/screen-header';
import { Check, ListMusic, X } from '@/components/ui/icons';
import { Text } from '@/components/ui/text';
import { moduleTint } from '@/constants/design-tokens';
import { colors } from '@/constants/theme';
import {
  usePlaylist,
  usePlaylistMutations,
  usePlaylistSongs,
} from '@/features/music/hooks/use-playlists';
import { useSongs } from '@/features/music/hooks/use-songs';
import { formatDuration } from '@/features/music/utils/format-duration';
import { useColorScheme } from '@/hooks/use-color-scheme';

export default function AddSongsToPlaylistScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme() ?? 'light';
  const tint = moduleTint('music', scheme);
  const { t } = useTranslation();

  const playlistQuery = usePlaylist(id);
  const { data: playlist } = playlistQuery;
  const libraryQuery = useSongs();
  const { data: library = [] } = libraryQuery;
  const { data: playlistSongs = [] } = usePlaylistSongs(id);
  const { addSong, removeSong } = usePlaylistMutations();

  const memberIds = useMemo(() => new Set(playlistSongs.map((song) => song.id)), [playlistSongs]);

  /**
   * A failed read is not a missing playlist. Same blank screen as "loading"
   * and "just deleted" before this; only those two are right to render
   * nothing. No title in the header — it came from the read that failed.
   */
  if (!playlist) {
    if (playlistQuery.isError) {
      return (
        <View className="flex-1 bg-background">
          <ScreenHeader />
          <QueryError error={playlistQuery.error} onRetry={() => playlistQuery.refetch()} />
        </View>
      );
    }
    return null;
  }

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen options={{ headerShown: false }} />

      <View
        style={{ paddingTop: insets.top + 12 }}
        className="flex-row items-center justify-between px-4 pb-2"
      >
        <Pressable
          accessibilityRole="button"
          onPress={() => router.back()}
          hitSlop={10}
          className="h-8 w-8 items-center justify-center rounded-full border border-border bg-surface"
        >
          <X size={17} color={colors[scheme].foreground} />
        </Pressable>
        <Text variant="sectionLabel">{t('music.addTo', { name: playlist.name })}</Text>
        <View className="h-8 w-8" />
      </View>

      {libraryQuery.isError ? (
        <QueryError error={libraryQuery.error} onRetry={() => libraryQuery.refetch()} />
      ) : library.length === 0 ? (
        <EmptyState
          icon={ListMusic}
          title={t('music.libraryEmptyTitle')}
          description={t('music.libraryEmptyBody')}
          tint={tint}
        />
      ) : (
        <FlashList
          data={library}
          keyExtractor={(song) => song.id}
          contentContainerStyle={{ paddingTop: 8, paddingBottom: 40 }}
          renderItem={({ item }) => {
            const inPlaylist = memberIds.has(item.id);
            return (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  Haptics.selectionAsync();
                  if (inPlaylist) removeSong.mutate({ playlistId: playlist.id, songId: item.id });
                  else addSong.mutate({ playlistId: playlist.id, songId: item.id });
                }}
                className="flex-row items-center gap-3 px-4 py-3"
              >
                <View
                  className="h-6 w-6 items-center justify-center rounded-full border"
                  style={{
                    borderColor: inPlaylist ? tint : colors[scheme].border,
                    backgroundColor: inPlaylist ? tint : 'transparent',
                  }}
                >
                  {inPlaylist && <Check size={13} color="#ffffff" />}
                </View>
                <View className="flex-1 gap-0.5">
                  <Text className="font-sora-medium" numberOfLines={1}>
                    {item.title}
                  </Text>
                  <Text variant="caption" numberOfLines={1}>
                    {item.artist ?? t('music.unknownArtist')}
                  </Text>
                </View>
                <Text variant="caption">{formatDuration(item.durationMs)}</Text>
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}
