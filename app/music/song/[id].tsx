import { formatDistanceToNow } from 'date-fns';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Heart, Trash2 } from '@/components/ui/icons';
import { Input } from '@/components/ui/input';
import { ScreenHeader } from '@/components/ui/screen-header';
import { Text } from '@/components/ui/text';
import { moduleTint } from '@/constants/design-tokens';
import { colors } from '@/constants/theme';
import { formatDuration } from '@/features/music/utils/format-duration';
import { useSongMutations, useSongs } from '@/features/music/hooks/use-songs';
import { useColorScheme } from '@/hooks/use-color-scheme';

const AUTOSAVE_DELAY_MS = 500;

export default function SongDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const tint = moduleTint('music', scheme);
  const { t } = useTranslation();

  const { data: songs = [] } = useSongs();
  const song = songs.find((item) => item.id === id) ?? null;
  const { update, remove, toggleFavorite } = useSongMutations();

  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');

  useEffect(() => {
    if (song) {
      setTitle(song.title);
      setArtist(song.artist ?? '');
    }
  }, [song?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!song || title === song.title || !title.trim()) return;
    const timeout = setTimeout(
      () => update.mutate({ id: song.id, input: { title: title.trim() } }),
      AUTOSAVE_DELAY_MS,
    );
    return () => clearTimeout(timeout);
  }, [title]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!song || artist === (song.artist ?? '')) return;
    const timeout = setTimeout(
      () => update.mutate({ id: song.id, input: { artist: artist.trim() || null } }),
      AUTOSAVE_DELAY_MS,
    );
    return () => clearTimeout(timeout);
  }, [artist]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!song) return null;

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen options={{ headerShown: false }} />

      <ScreenHeader
        eyebrow={t('music.songEyebrow')}
        tint={tint}
        actions={[
          {
            icon: Heart,
            label: song.isFavorite
              ? t('music.unfavoriteA11y', { title: song.title })
              : t('music.favoriteA11y', { title: song.title }),
            onPress: () => toggleFavorite.mutate({ id: song.id, isFavorite: !song.isFavorite }),
            tint: song.isFavorite ? tint : undefined,
          },
          {
            icon: Trash2,
            label: t('music.deleteSong'),
            onPress: () => {
              remove.mutate(song.id);
              router.back();
            },
            tint: colors[scheme].destructive,
          },
        ]}
      />

      <View className="gap-5 px-5 pt-2">
        <View className="gap-1.5">
          <Text variant="sectionLabel">{t('music.songTitle')}</Text>
          <Input
            surface="bare"
            value={title}
            onChangeText={setTitle}
            style={{ fontSize: 22, fontFamily: 'Sora_700Bold', color: colors[scheme].foreground }}
          />
        </View>

        <View className="gap-1.5">
          <Text variant="sectionLabel">{t('music.artist')}</Text>
          <Input
            surface="bare"
            value={artist}
            onChangeText={setArtist}
            accessibilityLabel={t('music.artist')}
            placeholder={t('music.unknownArtist')}
            className="text-lg text-foreground"
          />
        </View>

        <Text variant="muted">
          {t('music.duration', { duration: formatDuration(song.durationMs) })}
        </Text>
        <Text variant="muted">{t('music.playCount', { count: song.playCount })}</Text>
        {song.lastPlayedAt && (
          <Text variant="muted">
            {t('music.lastPlayed', {
              time: formatDistanceToNow(song.lastPlayedAt, { addSuffix: true }),
            })}
          </Text>
        )}
      </View>
    </View>
  );
}
