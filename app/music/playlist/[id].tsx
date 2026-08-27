import { FlashList } from '@shopify/flash-list';
import * as Haptics from 'expo-haptics';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { ListMusic, Play, Plus, Trash2 } from '@/components/ui/icons';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/empty-state';
import { ScreenHeader } from '@/components/ui/screen-header';
import { Text } from '@/components/ui/text';
import { moduleTint } from '@/constants/design-tokens';
import { colors } from '@/constants/theme';
import { SongRow } from '@/features/music/components/song-row';
import { useNowPlaying } from '@/features/music/hooks/use-player';
import {
  usePlaylist,
  usePlaylistMutations,
  usePlaylistSongs,
} from '@/features/music/hooks/use-playlists';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { confirm } from '@/lib/dialog-store';

const AUTOSAVE_DELAY_MS = 500;

export default function PlaylistDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const tint = moduleTint('music', scheme);
  const { t } = useTranslation();

  const { data: playlist } = usePlaylist(id);
  const { data: songs = [], isLoading } = usePlaylistSongs(id);
  const { rename, remove, removeSong } = usePlaylistMutations();
  const { currentSong, isPlaying, playQueue } = useNowPlaying();

  const [name, setName] = useState('');

  useEffect(() => {
    if (playlist) setName(playlist.name);
  }, [playlist?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!playlist || name === playlist.name || !name.trim()) return;
    const timeout = setTimeout(
      () => rename.mutate({ id: playlist.id, name: name.trim() }),
      AUTOSAVE_DELAY_MS,
    );
    return () => clearTimeout(timeout);
  }, [name]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!playlist) return null;

  const handleDeletePlaylist = () => {
    void confirm({
      title: t('music.deletePlaylistTitle'),
      message: t('music.deletePlaylistBody', { name: playlist.name }),
      confirmLabel: t('common.delete'),
      cancelLabel: t('common.cancel'),
      destructive: true,
    }).then(async (ok) => {
      if (!ok) return;
      remove.mutate(playlist.id);
      router.back();
    });
  };

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen options={{ headerShown: false }} />

      <ScreenHeader
        eyebrow={t('music.playlistEyebrow')}
        tint={tint}
        actions={[
          {
            icon: Trash2,
            label: t('music.deletePlaylist'),
            onPress: handleDeletePlaylist,
            tint: colors[scheme].destructive,
          },
        ]}
      />

      <View className="gap-3 px-5 pt-1">
        <Input
          surface="bare"
          value={name}
          onChangeText={setName}
          accessibilityLabel={t('music.playlistName')}
          placeholder={t('music.playlistName')}
          style={{ fontSize: 26, fontFamily: 'Sora_700Bold', color: colors[scheme].foreground }}
        />

        <View className="flex-row items-center justify-between">
          <Text variant="muted">{t('music.songsCount', { count: songs.length })}</Text>
          <View className="flex-row items-center gap-4">
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push(`/music/playlist/${playlist.id}/add-songs`)}
              className="flex-row items-center gap-1.5"
            >
              <Plus size={15} color={tint} />
              <Text variant="caption" className="font-sora-semibold" style={{ color: tint }}>
                {t('music.addSongs')}
              </Text>
            </Pressable>
            {songs.length > 0 && (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  Haptics.selectionAsync();
                  playQueue(songs, 0);
                }}
                className="flex-row items-center gap-1.5 rounded-full px-3 py-1.5"
                style={{ backgroundColor: tint }}
              >
                <Play size={13} color="#ffffff" fill="#ffffff" />
                <Text variant="caption" className="font-sora-semibold" style={{ color: '#ffffff' }}>
                  {t('music.playAll')}
                </Text>
              </Pressable>
            )}
          </View>
        </View>
      </View>

      {!isLoading && songs.length === 0 ? (
        <EmptyState
          icon={ListMusic}
          title={t('music.playlistEmptyTitle')}
          description={t('music.playlistEmptyBody')}
          actionLabel={t('music.addSongs')}
          onAction={() => router.push(`/music/playlist/${playlist.id}/add-songs`)}
          tint={tint}
        />
      ) : (
        <FlashList
          data={songs}
          keyExtractor={(song) => song.id}
          contentContainerStyle={{ paddingTop: 8, paddingBottom: 160 }}
          renderItem={({ item, index }) => (
            <SongRow
              song={item}
              isActive={currentSong?.id === item.id}
              isPlaying={isPlaying}
              onPress={() => playQueue(songs, index)}
              onLongPress={() => router.push(`/music/song/${item.id}`)}
              onRemove={() => removeSong.mutate({ playlistId: playlist.id, songId: item.id })}
            />
          )}
        />
      )}
    </View>
  );
}
