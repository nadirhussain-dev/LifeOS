import { usePathname, useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { ChevronDown, GripVertical, Pause, Play, SkipForward } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { cardClass } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { moduleTint } from '@/constants/design-tokens';
import { colors } from '@/constants/theme';
import { Equalizer } from '@/features/music/components/equalizer';
import { useNowPlaying } from '@/features/music/hooks/use-player';
import { usePlayerUiStore } from '@/features/music/store/player-ui-store';
import { songGradient } from '@/features/music/utils/song-art';
import { useColorScheme } from '@/hooks/use-color-scheme';

const SIDE_MARGIN = 12;
const ESTIMATED_HEIGHT = 60;

/**
 * Persistent, freely-draggable "now playing" widget. Mounted once at the app
 * root (app/_layout.tsx) so it floats over EVERY screen like a true top-level
 * player. Drag it to drop it anywhere on screen (position persisted); tap it to
 * open Now Playing; tap ⌄ to tuck it away — playback continues in the
 * background, and the bar returns when the next track starts. Hidden on the
 * Now Playing screen itself.
 */
export function MiniPlayerBar() {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme() ?? 'light';
  const tint = moduleTint('music', scheme);
  const { t } = useTranslation();
  const { width: screenW, height: screenH } = useWindowDimensions();
  const { currentSong, isPlaying, positionMs, durationMs, togglePlayPause, playNext } =
    useNowPlaying();

  const storeX = usePlayerUiStore((s) => s.x);
  const storeY = usePlayerUiStore((s) => s.y);
  const setPosition = usePlayerUiStore((s) => s.setPosition);
  const hidden = usePlayerUiStore((s) => s.hidden);
  const setHidden = usePlayerUiStore((s) => s.setHidden);

  const [barH, setBarH] = useState(ESTIMATED_HEIGHT);
  const barW = screenW - SIDE_MARGIN * 2;

  // Drag bounds (top-left position) that keep the whole bar on-screen.
  const minX = SIDE_MARGIN;
  const maxX = screenW - barW - SIDE_MARGIN;
  const minY = insets.top + 6;
  const maxY = screenH - barH - insets.bottom - 6;

  const posX = useSharedValue(SIDE_MARGIN);
  const posY = useSharedValue(0);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const didInit = useRef(false);

  // Seed the position from persisted store (or a bottom default) once the
  // layout height is known.
  useEffect(() => {
    if (didInit.current) return;
    const defaultY = screenH - insets.bottom - barH - 20;
    const seededX = storeX ?? SIDE_MARGIN;
    const seededY = storeY ?? defaultY;
    posX.value = Math.min(Math.max(seededX, minX), maxX);
    posY.value = Math.min(Math.max(seededY, minY), maxY);
    didInit.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenH, barH, storeX, storeY]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: posX.value }, { translateY: posY.value }],
  }));

  if (!currentSong) return null;
  // Dismissed by the user — playback carries on in the background.
  if (hidden) return null;
  // The full Now Playing screen is the player — don't overlay the mini bar on it.
  if (pathname === '/music/now-playing') return null;

  const progress = durationMs > 0 ? Math.min(1, positionMs / durationMs) : 0;
  const [c1, c2, c3] = songGradient(currentSong.id);

  const pan = Gesture.Pan()
    .activeOffsetX([-8, 8])
    .activeOffsetY([-8, 8])
    .onStart(() => {
      startX.value = posX.value;
      startY.value = posY.value;
    })
    .onUpdate((e) => {
      posX.value = startX.value + e.translationX;
      posY.value = startY.value + e.translationY;
    })
    .onEnd(() => {
      const cx = Math.min(Math.max(posX.value, minX), maxX);
      const cy = Math.min(Math.max(posY.value, minY), maxY);
      posX.value = withSpring(cx, { damping: 20, stiffness: 240 });
      posY.value = withSpring(cy, { damping: 20, stiffness: 240 });
      runOnJS(setPosition)(cx, cy);
    });

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        onLayout={(e) => setBarH(e.nativeEvent.layout.height)}
        style={[
          { position: 'absolute', left: 0, top: 0, width: barW },
          animatedStyle,
          {
            shadowColor: tint,
            shadowOpacity: 0.28,
            shadowRadius: 14,
            shadowOffset: { width: 0, height: 6 },
            elevation: 10,
          },
        ]}
        className={cardClass({ padding: 'none' }, 'overflow-hidden')}
      >
        <View className="h-[2px] w-full bg-muted">
          <View className="h-full" style={{ width: `${progress * 100}%`, backgroundColor: tint }} />
        </View>
        <View className="flex-row items-center gap-1.5 py-2 pe-2.5 ps-1.5">
          {/* Drag handle */}
          <View
            className="items-center justify-center px-0.5"
            accessibilityLabel={t('music.dragToMove')}
          >
            <GripVertical size={16} color={colors[scheme].mutedForeground} />
          </View>

          {/* Tap target → Now Playing */}
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/music/now-playing')}
            className="flex-1 flex-row items-center gap-2.5"
            accessibilityLabel={t('music.openNowPlaying')}
          >
            <LinearGradient
              colors={[c1, c2, c3]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{
                height: 38,
                width: 38,
                borderRadius: 10,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {isPlaying && <Equalizer size={13} playing color="#ffffff" />}
            </LinearGradient>
            <View className="flex-1">
              <Text className="font-sora-semibold" numberOfLines={1}>
                {currentSong.title}
              </Text>
              <Text variant="caption" numberOfLines={1}>
                {currentSong.artist ?? t('music.unknownArtist')}
              </Text>
            </View>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            onPress={togglePlayPause}
            hitSlop={6}
            className="h-9 w-9 items-center justify-center"
            accessibilityLabel={isPlaying ? t('music.pause') : t('music.play')}
          >
            {isPlaying ? (
              <Pause size={20} color={colors[scheme].foreground} fill={colors[scheme].foreground} />
            ) : (
              <Play size={20} color={colors[scheme].foreground} fill={colors[scheme].foreground} />
            )}
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={playNext}
            hitSlop={6}
            className="h-9 w-9 items-center justify-center"
            accessibilityLabel={t('music.nextTrack')}
          >
            <SkipForward
              size={18}
              color={colors[scheme].foreground}
              fill={colors[scheme].foreground}
            />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => setHidden(true)}
            hitSlop={6}
            className="h-9 w-9 items-center justify-center"
            accessibilityLabel={t('music.hidePlayer')}
          >
            <ChevronDown size={18} color={colors[scheme].mutedForeground} />
          </Pressable>
        </View>
      </Animated.View>
    </GestureDetector>
  );
}
