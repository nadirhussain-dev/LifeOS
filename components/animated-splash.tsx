import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { LifeOSMark } from '@/components/ui/lifeos-mark';
import { colors } from '@/constants/design-tokens';
import { useColorScheme } from '@/hooks/use-color-scheme';

// Per-theme brand grounds. Derived rather than hand-typed: all eight values
// were an exact copy of the corresponding token, so the table looked correct
// while being one retune away from a splash that doesn't match the app it
// hands off to.
//
// These also have to match the native splash backgroundColor in app.json
// (expo-splash-screen light/dark) for the OS-splash hand-off to be seamless —
// that one is a JSON config and can't import from here, so if `background`
// ever changes, app.json needs the same edit by hand.
const THEME = {
  light: {
    bg: colors.light.background,
    mark: colors.light.accent,
    glyph: colors.light.accentForeground,
    word: colors.light.foreground,
  },
  dark: {
    bg: colors.dark.background,
    mark: colors.dark.accent,
    glyph: colors.dark.accentForeground,
    word: colors.dark.foreground,
  },
} as const;

/**
 * A short, calm branded splash that plays once on cold start after the native
 * splash hides: the emerald mark springs in, the wordmark rises beneath it,
 * then the whole layer fades away to reveal the app. Purpose before decoration
 * — one gentle moment, ~2s total, then gone.
 */
export function AnimatedSplash({ onFinish }: { onFinish: () => void }) {
  const scheme = useColorScheme() ?? 'light';
  const c = THEME[scheme];

  const container = useSharedValue(1);
  const markScale = useSharedValue(0.82);
  const markOpacity = useSharedValue(0);
  const wordOpacity = useSharedValue(0);
  const wordShift = useSharedValue(10);

  useEffect(() => {
    markOpacity.value = withTiming(1, { duration: 320 });
    markScale.value = withSpring(1, { damping: 12, stiffness: 160 });
    wordOpacity.value = withDelay(220, withTiming(1, { duration: 320 }));
    wordShift.value = withDelay(220, withSpring(0, { damping: 14, stiffness: 180 }));
    // Hold, then fade the whole layer out and notify the parent to unmount it.
    container.value = withDelay(
      1600,
      withTiming(0, { duration: 420, easing: Easing.bezier(0.3, 0, 1, 1) }, (finished) => {
        if (finished) runOnJS(onFinish)();
      }),
    );
  }, [container, markOpacity, markScale, onFinish, wordOpacity, wordShift]);

  const containerStyle = useAnimatedStyle(() => ({ opacity: container.value }));
  const markStyle = useAnimatedStyle(() => ({
    opacity: markOpacity.value,
    transform: [{ scale: markScale.value }],
  }));
  const wordStyle = useAnimatedStyle(() => ({
    opacity: wordOpacity.value,
    transform: [{ translateY: wordShift.value }],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFillObject,
        styles.fill,
        { backgroundColor: c.bg },
        containerStyle,
      ]}
    >
      <Animated.View style={markStyle}>
        <View style={[styles.mark, { backgroundColor: c.mark, shadowColor: c.mark }]}>
          {/* Was a generic Lucide leaf — so the launcher icon, the native
              splash and this one were three different marks. */}
          <LifeOSMark size={40} color={c.glyph} layered={false} />
        </View>
      </Animated.View>
      <Animated.Text style={[styles.word, { color: c.word }, wordStyle]}>LifeOS</Animated.Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fill: {
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
  },
  mark: {
    width: 88,
    height: 88,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.35,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },
  word: {
    marginTop: 22,
    fontFamily: 'Sora_800ExtraBold',
    fontSize: 28,
    letterSpacing: -0.8,
  },
});
