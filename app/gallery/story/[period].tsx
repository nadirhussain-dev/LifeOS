import { format } from 'date-fns/format';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { X } from '@/components/ui/icons';
import { Text } from '@/components/ui/text';
import {
  displayUri,
  isOnThisDevice,
  type GalleryPhoto,
} from '@/features/gallery/types/gallery.types';
import { usePhotos } from '@/features/gallery/hooks/use-gallery';
import { moduleTint } from '@/constants/design-tokens';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { alpha } from '@/lib/color';

const SLIDE_MS = 3800;

/** One segment bar at the top; fills as its slide plays. */
function Segment({ progress }: { progress: SharedValue<number> }) {
  const style = useAnimatedStyle(() => ({
    width: `${Math.min(100, Math.max(0, progress.value * 100))}%`,
  }));
  return (
    <View
      className="h-1 flex-1 overflow-hidden rounded-full"
      style={{ backgroundColor: alpha('#ffffff', 0.3) }}
    >
      <Animated.View
        className="h-full rounded-full"
        style={[{ backgroundColor: '#ffffff' }, style]}
      />
    </View>
  );
}

export default function StoryPlayerScreen() {
  const { period, album } = useLocalSearchParams<{ period: string; album?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const scheme = useColorScheme() ?? 'light';
  const tint = moduleTint('gallery', scheme);
  const { width, height } = useWindowDimensions();
  const { data: photos = [], isError } = usePhotos();

  const story = useMemo<GalleryPhoto[]>(() => {
    // A story is nothing but full-bleed pixels, so media whose file lives on
    // another device is left out rather than shown as a blank frame the user
    // has to tap past.
    const available = photos.filter(isOnThisDevice);
    const scoped = album ? available.filter((p) => p.albumId === album) : available;
    const sorted = [...scoped].sort((a, b) => a.takenAt - b.takenAt); // oldest → newest
    if (period === 'all' || !period) return sorted;
    return sorted.filter((p) => format(p.takenAt, 'yyyy-MM') === period);
  }, [photos, period, album]);

  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  const seg = useSharedValue(0);
  const kb = useSharedValue(0);
  const dragY = useSharedValue(0);

  const current = story[index];

  // Bail out if there's nothing to show.
  //
  // A failed read counts. Without it the screen sits on the black backdrop
  // below forever: the read returns no photos, so the "loaded but empty" test
  // never fires, and a story player has no frame to put an error panel in.
  // Going back returns the person to the screen that launched this one, which
  // reports the failure properly and offers the retry.
  useEffect(() => {
    if (isError || (photos.length > 0 && story.length === 0)) router.back();
  }, [isError, photos.length, story.length, router]);

  const goNext = () => {
    setIndex((i) => {
      if (i >= story.length - 1) {
        router.back();
        return i;
      }
      return i + 1;
    });
  };
  const goPrev = () => setIndex((i) => Math.max(0, i - 1));

  // Reset segment + Ken Burns whenever the slide changes.
  useEffect(() => {
    seg.value = 0;
    kb.value = 0;
  }, [index, seg, kb]);

  // Drive the active segment + Ken Burns; pause freezes them.
  useEffect(() => {
    if (!current || paused) {
      cancelAnimation(seg);
      cancelAnimation(kb);
      return;
    }
    const remaining = Math.max(80, SLIDE_MS * (1 - seg.value));
    seg.value = withTiming(1, { duration: remaining, easing: Easing.linear }, (finished) => {
      if (finished) runOnJS(goNext)();
    });
    kb.value = withTiming(1, { duration: SLIDE_MS, easing: Easing.out(Easing.quad) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, paused, current]);

  const kbStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: 1 + kb.value * 0.14 },
      { translateX: kb.value * -10 },
      { translateY: kb.value * -6 },
    ],
  }));
  const containerStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: dragY.value }],
    opacity: 1 - Math.min(0.6, Math.abs(dragY.value) / 400),
  }));

  const swipeDown = Gesture.Pan()
    .activeOffsetY([18, 9999])
    .onUpdate((e) => {
      dragY.value = Math.max(0, e.translationY);
    })
    .onEnd((e) => {
      if (e.translationY > 130) runOnJS(router.back)();
      else dragY.value = withTiming(0, { duration: 180 });
    });

  if (!current) return <View style={{ flex: 1, backgroundColor: '#000' }} />;

  return (
    <GestureDetector gesture={swipeDown}>
      <Animated.View style={[{ flex: 1, backgroundColor: '#000' }, containerStyle]}>
        {/* Ken Burns media */}
        <Animated.View style={[{ position: 'absolute', width, height }, kbStyle]}>
          <Image
            source={{ uri: displayUri(current) ?? undefined }}
            style={{ width, height }}
            contentFit="cover"
            recyclingKey={current.id}
          />
        </Animated.View>
        {/* Legibility scrims */}
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 160,
            backgroundColor: alpha('#000000', 0.35),
          }}
        />
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: 200,
            backgroundColor: alpha('#000000', 0.4),
          }}
        />

        {/* Tap zones: left third = prev, right = next; hold to pause */}
        <View style={{ position: 'absolute', inset: 0, flexDirection: 'row' }}>
          <Pressable
            accessibilityRole="button"
            style={{ width: '32%' }}
            onPress={goPrev}
            onLongPress={() => setPaused(true)}
            onPressOut={() => setPaused(false)}
            delayLongPress={180}
          />
          <Pressable
            accessibilityRole="button"
            style={{ flex: 1 }}
            onPress={goNext}
            onLongPress={() => setPaused(true)}
            onPressOut={() => setPaused(false)}
            delayLongPress={180}
          />
        </View>

        {/* Top: segments + close */}
        <View style={{ position: 'absolute', top: insets.top + 8, left: 12, right: 12, gap: 10 }}>
          <View className="flex-row gap-1.5">
            {story.map((p, i) => (
              <View
                key={p.id}
                className="h-1 flex-1 overflow-hidden rounded-full"
                style={{ backgroundColor: alpha('#ffffff', 0.3) }}
              >
                {i < index ? (
                  <View
                    className="h-full w-full rounded-full"
                    style={{ backgroundColor: '#ffffff' }}
                  />
                ) : i === index ? (
                  <Segment progress={seg} />
                ) : null}
              </View>
            ))}
          </View>
          <View className="flex-row items-center justify-between">
            <Text style={{ color: '#ffffff', fontSize: 13 }} className="font-sora-semibold">
              {format(current.takenAt, 'EEEE, MMM d, yyyy')}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.back()}
              hitSlop={10}
              accessibilityLabel={t('common.close')}
            >
              <X size={22} color="#ffffff" />
            </Pressable>
          </View>
        </View>

        {/* Bottom: caption + tags */}
        {(current.caption || current.tags.length > 0) && (
          <View
            style={{
              position: 'absolute',
              bottom: insets.bottom + 24,
              left: 20,
              right: 20,
              gap: 6,
            }}
          >
            {current.caption ? (
              <Text style={{ color: '#ffffff', fontSize: 16 }} className="font-sora-medium">
                {current.caption}
              </Text>
            ) : null}
            {current.tags.length > 0 && (
              <View className="flex-row flex-wrap gap-2">
                {current.tags.map((tag) => (
                  <Text
                    key={tag}
                    style={{ color: tint, fontSize: 13 }}
                    className="font-sora-semibold"
                  >
                    #{tag}
                  </Text>
                ))}
              </View>
            )}
          </View>
        )}
      </Animated.View>
    </GestureDetector>
  );
}
