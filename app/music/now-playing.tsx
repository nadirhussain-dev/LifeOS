import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  ChevronDown,
  Heart,
  ListMusic,
  Moon,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  X,
} from '@/components/ui/icons';
import { Text } from '@/components/ui/text';
import { ArtworkOrb } from '@/features/music/components/artwork-orb';
import { AuroraBackground } from '@/features/music/components/aurora-background';
import { QueueSheet } from '@/features/music/components/queue-sheet';
import { SleepTimerSheet } from '@/features/music/components/sleep-timer-sheet';
import { WaveformScrubber } from '@/features/music/components/waveform-scrubber';
import { useNowPlaying } from '@/features/music/hooks/use-player';
import { useSongMutations, useSongs } from '@/features/music/hooks/use-songs';
import { songColor } from '@/features/music/utils/song-art';
import { formatDuration } from '@/features/music/utils/format-duration';
import { alpha } from '@/lib/color';
import type { RepeatMode } from '@/features/music/types/music.types';

const REPEAT_CYCLE: Record<RepeatMode, RepeatMode> = { off: 'all', all: 'one', one: 'off' };
const WHITE = '#ffffff';

/** Frosted round chip used for the header + secondary actions. */
function GlassChip({
  children,
  onPress,
  label,
}: {
  children: React.ReactNode;
  onPress: () => void;
  label: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      hitSlop={10}
      accessibilityLabel={label}
      className="h-10 w-10 items-center justify-center rounded-full"
      style={{
        backgroundColor: alpha(WHITE, 0.14),
        borderWidth: 1,
        borderColor: alpha(WHITE, 0.14),
      }}
    >
      {children}
    </Pressable>
  );
}

export default function NowPlayingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const {
    currentSong,
    isPlaying,
    positionMs,
    durationMs,
    shuffle,
    repeatMode,
    queue,
    currentIndex,
    sleepTimerEndsAt,
    togglePlayPause,
    playNext,
    playPrevious,
    seekTo,
    toggleShuffle,
    setRepeatMode,
    setSleepTimer,
    jumpToIndex,
    clearPlayer,
  } = useNowPlaying();

  const { data: songs = [] } = useSongs();
  const { toggleFavorite } = useSongMutations();

  const [queueOpen, setQueueOpen] = useState(false);
  const [sleepOpen, setSleepOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!sleepTimerEndsAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [sleepTimerEndsAt]);

  if (!currentSong) return null;

  // The queue holds a snapshot from whenever it was built, so favorite state
  // is read from the live library query instead — otherwise toggling it here
  // wouldn't visibly update until the queue was rebuilt.
  const liveSong = songs.find((song) => song.id === currentSong.id) ?? currentSong;
  const seed = currentSong.id;
  const accent = songColor(seed);
  const RepeatIcon = repeatMode === 'one' ? Repeat1 : Repeat;
  const sleepRemainingMs = sleepTimerEndsAt ? Math.max(0, sleepTimerEndsAt - now) : 0;
  const sleepActive = sleepRemainingMs > 0;
  const progress = durationMs > 0 ? Math.min(1, positionMs / durationMs) : 0;

  const dismiss = () => {
    clearPlayer();
    router.back();
  };

  return (
    <View className="flex-1">
      <AuroraBackground color={accent} />

      <View
        style={{ paddingTop: insets.top + 12, paddingBottom: insets.bottom + 16 }}
        className="flex-1 px-6"
      >
        {/* Header */}
        <View className="flex-row items-center justify-between">
          <GlassChip onPress={() => router.back()} label={t('music.minimize')}>
            <ChevronDown size={20} color={WHITE} />
          </GlassChip>
          <Text
            style={{ color: alpha(WHITE, 0.75), fontSize: 11, letterSpacing: 1 }}
            className="font-sora-semibold uppercase"
          >
            {queue.length > 0
              ? t('music.indexOfTotal', { index: currentIndex + 1, total: queue.length })
              : t('music.nowPlaying')}
          </Text>
          <GlassChip onPress={dismiss} label={t('music.stopAndClose')}>
            <X size={18} color={WHITE} />
          </GlassChip>
        </View>

        {/* Artwork */}
        <View className="flex-1 items-center justify-center">
          <ArtworkOrb seed={seed} size={280} playing={isPlaying} />
        </View>

        {/* Title */}
        <View className="flex-row items-center gap-3 pb-5">
          <View className="flex-1 gap-1">
            <Text
              numberOfLines={1}
              className="font-sora-extrabold text-2xl"
              style={{ color: WHITE }}
            >
              {currentSong.title}
            </Text>
            <Text numberOfLines={1} style={{ color: alpha(WHITE, 0.7), fontSize: 15 }}>
              {currentSong.artist ?? t('music.unknownArtist')}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              liveSong.isFavorite
                ? t('music.unfavoriteA11y', { title: liveSong.title })
                : t('music.favoriteA11y', { title: liveSong.title })
            }
            accessibilityState={{ selected: liveSong.isFavorite }}
            onPress={() =>
              toggleFavorite.mutate({ id: currentSong.id, isFavorite: !liveSong.isFavorite })
            }
            hitSlop={12}
          >
            <Heart
              size={24}
              color={liveSong.isFavorite ? accent : WHITE}
              fill={liveSong.isFavorite ? accent : 'transparent'}
            />
          </Pressable>
        </View>

        {/* Waveform seek */}
        <WaveformScrubber
          seed={seed}
          progress={progress}
          playing={isPlaying}
          color={accent}
          onSeek={(f) => seekTo((f * durationMs) / 1000)}
        />
        <View className="mt-1 flex-row justify-between">
          <Text style={{ color: alpha(WHITE, 0.6), fontSize: 11 }} className="font-sora-medium">
            {formatDuration(positionMs)}
          </Text>
          <Text style={{ color: alpha(WHITE, 0.6), fontSize: 11 }} className="font-sora-medium">
            {formatDuration(durationMs)}
          </Text>
        </View>

        {/* Transport */}
        <View className="mt-5 flex-row items-center justify-between">
          <Pressable
            accessibilityRole="button"
            onPress={toggleShuffle}
            hitSlop={12}
            accessibilityLabel={t('music.shuffle')}
          >
            <Shuffle size={20} color={shuffle ? accent : alpha(WHITE, 0.55)} />
          </Pressable>

          <View className="flex-row items-center gap-7">
            <Pressable
              accessibilityRole="button"
              onPress={playPrevious}
              hitSlop={12}
              accessibilityLabel={t('music.previous')}
            >
              <SkipBack size={28} color={WHITE} fill={WHITE} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={togglePlayPause}
              accessibilityLabel={isPlaying ? t('music.pause') : t('music.play')}
              className="h-[72px] w-[72px] items-center justify-center rounded-full"
              style={{ backgroundColor: WHITE }}
            >
              {isPlaying ? (
                <Pause size={30} color="#0b0b10" fill="#0b0b10" />
              ) : (
                <Play size={30} color="#0b0b10" fill="#0b0b10" style={{ marginLeft: 3 }} />
              )}
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={playNext}
              hitSlop={12}
              accessibilityLabel={t('music.next')}
            >
              <SkipForward size={28} color={WHITE} fill={WHITE} />
            </Pressable>
          </View>

          <Pressable
            accessibilityRole="button"
            onPress={() => setRepeatMode(REPEAT_CYCLE[repeatMode])}
            hitSlop={12}
            accessibilityLabel={t('music.repeat')}
          >
            <RepeatIcon size={20} color={repeatMode === 'off' ? alpha(WHITE, 0.55) : accent} />
          </Pressable>
        </View>

        {/* Sleep + Up Next */}
        <View className="mt-6 flex-row gap-3">
          <Pressable
            accessibilityRole="button"
            onPress={() => setSleepOpen(true)}
            className="flex-1 flex-row items-center justify-center gap-2 rounded-2xl py-3.5"
            style={{
              backgroundColor: alpha(WHITE, sleepActive ? 0.2 : 0.1),
              borderWidth: 1,
              borderColor: alpha(WHITE, 0.14),
            }}
          >
            <Moon size={16} color={sleepActive ? accent : WHITE} />
            <Text className="font-sora-semibold" style={{ color: WHITE }}>
              {sleepActive ? formatDuration(sleepRemainingMs) : t('music.sleep')}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => setQueueOpen(true)}
            className="flex-1 flex-row items-center justify-center gap-2 rounded-2xl py-3.5"
            style={{
              backgroundColor: alpha(WHITE, 0.1),
              borderWidth: 1,
              borderColor: alpha(WHITE, 0.14),
            }}
          >
            <ListMusic size={16} color={WHITE} />
            <Text className="font-sora-semibold" style={{ color: WHITE }}>
              {t('music.upNext')}
            </Text>
          </Pressable>
        </View>
      </View>

      <QueueSheet
        visible={queueOpen}
        onClose={() => setQueueOpen(false)}
        queue={queue}
        currentIndex={currentIndex}
        isPlaying={isPlaying}
        onJump={jumpToIndex}
      />
      <SleepTimerSheet
        visible={sleepOpen}
        onClose={() => setSleepOpen(false)}
        remainingMs={sleepRemainingMs}
        active={sleepActive}
        onSelect={setSleepTimer}
      />
    </View>
  );
}
