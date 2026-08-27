import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { Music2 } from '@/components/ui/icons';
import { Text } from '@/components/ui/text';
import { songGradient } from '@/features/music/utils/song-art';
import { alpha, glowShadow, tintGradientTriple } from '@/lib/color';
import type { Playlist } from '@/features/music/types/music.types';

type Props = {
  playlist: Playlist;
  onPress: () => void;
};

/** A rich gradient playlist card — its own color (from the playlist's tint) or a
 *  generative gradient when untinted, with the name + count laid over it. */
export function PlaylistTile({ playlist, onPress }: Props) {
  const { t } = useTranslation();
  const gradient = playlist.colorToken
    ? tintGradientTriple(playlist.colorToken)
    : songGradient(playlist.id);

  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={playlist.name}>
      <View className="h-40 w-40 overflow-hidden rounded-3xl" style={glowShadow(gradient[1], 0.3)}>
        <LinearGradient
          colors={gradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ flex: 1, padding: 14, justifyContent: 'space-between' }}
        >
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: -20,
              right: -16,
              width: 80,
              height: 80,
              borderRadius: 40,
              backgroundColor: alpha('#ffffff', 0.12),
            }}
          />
          <View
            className="h-9 w-9 items-center justify-center rounded-full"
            style={{ backgroundColor: alpha('#ffffff', 0.22) }}
          >
            <Music2 size={18} color="#ffffff" />
          </View>
          <View className="gap-0.5">
            <Text
              className="font-sora-bold"
              numberOfLines={2}
              style={{ color: '#ffffff', fontSize: 15 }}
            >
              {playlist.name}
            </Text>
            <Text style={{ color: alpha('#ffffff', 0.85), fontSize: 11 }}>
              {t('music.songsCount', { count: playlist.songCount })}
            </Text>
          </View>
        </LinearGradient>
      </View>
    </Pressable>
  );
}
