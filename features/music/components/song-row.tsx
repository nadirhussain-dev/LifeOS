import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { CloudOff, Heart, Pause, Play, Trash2, X } from 'lucide-react-native';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { SwipeableRow } from '@/components/ui/swipeable-row';
import { Text } from '@/components/ui/text';
import { moduleTint } from '@/constants/design-tokens';
import { colors } from '@/constants/theme';
import { Equalizer } from '@/features/music/components/equalizer';
import { isPlayable } from '@/features/music/services/player-controller';
import { songGradient } from '@/features/music/utils/song-art';
import { formatDuration } from '@/features/music/utils/format-duration';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { Song } from '@/features/music/types/music.types';

type Props = {
  song: Song;
  isActive: boolean;
  isPlaying: boolean;
  onPress: () => void;
  /** Opens the song's rename/details screen — kept off the main tap target since tapping a row plays it. */
  onLongPress?: () => void;
  /** Library context: permanently deletes the song and frees its file. */
  onDelete?: () => void;
  /** Playlist context: unlinks the song from this playlist only. */
  onRemove?: () => void;
  /** Omit to hide the favorite heart entirely (e.g. a context where toggling
   * it doesn't make sense); pass it everywhere the row can be favorited. */
  onToggleFavorite?: () => void;
};

function SongRowComponent({
  song,
  isActive,
  isPlaying,
  onPress,
  onLongPress,
  onDelete,
  onRemove,
  onToggleFavorite,
}: Props) {
  const scheme = useColorScheme() ?? 'light';
  const tint = moduleTint('music', scheme);
  const { t } = useTranslation();
  const [c1, c2, c3] = songGradient(song.id);
  // The row synced from another device; the audio file did not. It stays
  // visible and removable — just not playable — because the alternative is a
  // library that silently shrinks when you sign in on a new phone.
  const playable = isPlayable(song);

  const row = (
    <Pressable
      onPress={() => {
        void Haptics.selectionAsync();
        onPress();
      }}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={
        playable
          ? `${song.title}, ${song.artist ?? t('music.unknownArtist')}`
          : `${song.title}, ${t('music.notOnThisDevice')}`
      }
      accessibilityHint={playable ? t('music.playHint') : undefined}
      accessibilityState={{ selected: isActive, disabled: !playable }}
      className="flex-row items-center gap-3 px-4 py-2.5"
      style={{ opacity: playable ? 1 : 0.55 }}
    >
      {/* Generative art thumbnail */}
      <View className="h-11 w-11 overflow-hidden rounded-xl">
        <LinearGradient
          colors={[c1, c2, c3]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
        >
          <View
            className="h-6 w-6 items-center justify-center rounded-full"
            style={{ backgroundColor: 'rgba(0,0,0,0.32)' }}
          >
            {!playable ? (
              <CloudOff size={12} color="#ffffff" />
            ) : isActive && isPlaying ? (
              <Equalizer size={13} playing color="#ffffff" />
            ) : isActive ? (
              <Pause size={13} color="#ffffff" fill="#ffffff" />
            ) : (
              <Play size={12} color="#ffffff" fill="#ffffff" style={{ marginLeft: 1 }} />
            )}
          </View>
        </LinearGradient>
      </View>

      <View className="flex-1 gap-0.5">
        <Text
          className="font-sora-medium"
          numberOfLines={1}
          style={{ color: isActive ? tint : colors[scheme].foreground }}
        >
          {song.title}
        </Text>
        <Text variant="caption" numberOfLines={1}>
          {playable ? (song.artist ?? t('music.unknownArtist')) : t('music.notOnThisDevice')}
        </Text>
      </View>

      <Text variant="caption">{formatDuration(song.durationMs)}</Text>

      {onToggleFavorite && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            song.isFavorite
              ? t('music.unfavoriteA11y', { title: song.title })
              : t('music.favoriteA11y', { title: song.title })
          }
          accessibilityState={{ selected: song.isFavorite }}
          onPress={() => {
            void Haptics.selectionAsync();
            onToggleFavorite();
          }}
          hitSlop={10}
          className="p-1"
        >
          <Heart
            size={16}
            color={song.isFavorite ? tint : colors[scheme].mutedForeground}
            fill={song.isFavorite ? tint : 'transparent'}
          />
        </Pressable>
      )}
    </Pressable>
  );

  if (!onDelete && !onRemove) return row;

  return (
    <SwipeableRow
      accessibilityActions={[
        onDelete
          ? { name: 'delete', label: t('common.delete') }
          : { name: 'remove', label: t('common.remove') },
      ]}
      onAccessibilityAction={(name) =>
        name === 'delete' ? onDelete?.() : name === 'remove' ? onRemove?.() : undefined
      }
      actions={
        onDelete ? (
          <Pressable
            onPress={onDelete}
            accessibilityRole="button"
            accessibilityLabel={t('music.deleteSongA11y', { title: song.title })}
            className="flex-1 items-center justify-center bg-destructive"
          >
            <Trash2 color={colors[scheme].primaryForeground} size={18} />
          </Pressable>
        ) : (
          <Pressable
            onPress={onRemove}
            accessibilityRole="button"
            accessibilityLabel={t('music.removeFromPlaylistA11y', { title: song.title })}
            className="flex-1 items-center justify-center bg-secondary"
          >
            <X color={colors[scheme].foreground} size={18} />
          </Pressable>
        )
      }
    >
      {row}
    </SwipeableRow>
  );
}

/** Memoised — library and playlist screens re-render the full song list often. */
export const SongRow = memo(SongRowComponent);
