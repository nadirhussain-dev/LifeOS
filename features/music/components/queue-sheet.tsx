import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ListMusic } from '@/components/ui/icons';
import { Text } from '@/components/ui/text';
import { moduleTint } from '@/constants/design-tokens';
import { colors } from '@/constants/theme';
import { Equalizer } from '@/features/music/components/equalizer';
import { formatDuration } from '@/features/music/utils/format-duration';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { Song } from '@/features/music/types/music.types';

type Props = {
  visible: boolean;
  onClose: () => void;
  queue: Song[];
  currentIndex: number;
  isPlaying: boolean;
  onJump: (index: number) => void;
};

/** The playback queue as a bottom sheet — the currently-playing track shows an
 * equalizer, upcoming tracks are tappable to jump straight to them. */
export function QueueSheet({ visible, onClose, queue, currentIndex, isPlaying, onJump }: Props) {
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme() ?? 'light';
  const tint = moduleTint('music', scheme);
  const { t } = useTranslation();
  const { height } = useWindowDimensions();

  const jump = (index: number) => {
    onJump(index);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable
        accessibilityRole="button"
        className="flex-1"
        style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
        onPress={onClose}
      >
        <View className="flex-1 justify-end">
          <Pressable
            accessibilityRole="button"
            onPress={(e) => e.stopPropagation()}
            style={{ paddingBottom: insets.bottom + 8, maxHeight: height * 0.7 }}
            className="rounded-t-3xl bg-card px-2 pt-3"
          >
            <View
              className="mb-1 h-1 w-10 self-center rounded-full"
              style={{ backgroundColor: colors[scheme].border }}
            />
            <View className="flex-row items-center gap-2 px-3 pb-2">
              <ListMusic size={18} color={tint} />
              <Text variant="subheading">{t('music.upNext')}</Text>
              <Text variant="caption">· {t('music.tracksCount', { count: queue.length })}</Text>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              {queue.map((song, index) => {
                const isCurrent = index === currentIndex;
                const isPast = index < currentIndex;
                return (
                  <Pressable
                    accessibilityRole="button"
                    key={`${song.id}-${index}`}
                    onPress={() => jump(index)}
                    className="flex-row items-center gap-3 rounded-2xl px-3 py-2.5"
                    style={{ opacity: isPast ? 0.45 : 1 }}
                  >
                    <View className="h-8 w-8 items-center justify-center">
                      {isCurrent ? (
                        <Equalizer size={15} playing={isPlaying} color={tint} />
                      ) : (
                        <Text variant="caption" className="font-sora-semibold">
                          {index + 1}
                        </Text>
                      )}
                    </View>
                    <View className="flex-1">
                      <Text
                        className="font-sora-medium"
                        numberOfLines={1}
                        style={{ color: isCurrent ? tint : colors[scheme].foreground }}
                      >
                        {song.title}
                      </Text>
                      <Text variant="caption" numberOfLines={1}>
                        {song.artist ?? t('music.unknownArtist')}
                      </Text>
                    </View>
                    <Text variant="caption">{formatDuration(song.durationMs)}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}
