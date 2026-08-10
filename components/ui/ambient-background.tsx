import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';

import { moduleTints, type ThemeName } from '@/constants/design-tokens';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { alpha } from '@/lib/color';

/**
 * The hour of the day, as the two tints the wash is built from.
 *
 * Not decoration for its own sake: the app is a *life* OS, and the one piece
 * of context it always has and never shows is what time it is. A dashboard
 * that looks the same at 6am and 11pm is throwing that away. This gives the
 * whole app a slow diurnal drift the user never consciously notices and would
 * miss immediately.
 *
 * Tints come from the module registry rather than new hexes, so the wash is
 * always a colour the app already speaks — sleep's indigo at night, water's
 * cyan at dawn, fitness's orange at dusk.
 */
function washFor(hour: number): { from: string; to: string; strength: number } {
  const t = (name: keyof typeof moduleTints, theme: ThemeName) => moduleTints[name][theme];
  // Strength is the ceiling on how present the wash is; the small hours and
  // the middle of the day get the least, because that is when a tinted screen
  // is most likely to read as "something is wrong with my display".
  if (hour < 5) return { from: t('sleep', 'dark'), to: t('study', 'dark'), strength: 0.1 };
  if (hour < 8) return { from: t('water', 'light'), to: t('notes', 'light'), strength: 0.09 };
  if (hour < 12) return { from: t('habit', 'light'), to: t('water', 'light'), strength: 0.07 };
  if (hour < 17) return { from: t('calendar', 'light'), to: t('habit', 'light'), strength: 0.05 };
  if (hour < 20) return { from: t('fitness', 'light'), to: t('goals', 'light'), strength: 0.09 };
  if (hour < 23) return { from: t('journal', 'dark'), to: t('sleep', 'dark'), strength: 0.1 };
  return { from: t('sleep', 'dark'), to: t('vault', 'dark'), strength: 0.1 };
}

/** Re-read the clock every ten minutes — the wash moves far slower than that,
 *  so anything more frequent is wasted work. */
const TICK_MS = 10 * 60 * 1000;

/**
 * A very slow, very faint two-stop wash behind the entire app.
 *
 * Built from stacked `expo-linear-gradient`, already a dependency — no Skia,
 * no native rebuild, no mesh shader. A true mesh gradient would be prettier
 * and is not worth a native module for something rendered at 5–10% opacity.
 *
 * Sits behind everything, including the grain, and never intercepts touches.
 */
export function AmbientBackground() {
  const scheme = useColorScheme() ?? 'light';
  const [hour, setHour] = useState(() => new Date().getHours());

  useEffect(() => {
    const tick = () => setHour(new Date().getHours());
    const timer = setInterval(tick, TICK_MS);
    // A phone left backgrounded overnight comes back to a stale interval, so
    // re-read the clock the moment the app is looked at again.
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') tick();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, []);

  const { from, to, strength } = washFor(hour);
  // Dark grounds swallow a tint far faster than light ones, so the same
  // nominal strength has to be pushed harder to register at all.
  const scale = scheme === 'dark' ? 1.6 : 1;

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} accessible={false}>
      <LinearGradient
        colors={[alpha(from, strength * scale), 'transparent', alpha(to, strength * scale * 0.8)]}
        locations={[0, 0.55, 1]}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}
