import * as Haptics from 'expo-haptics';
import { useEffect, useRef } from 'react';
import {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

/**
 * Detects `value` landing exactly on one of `milestones` and returns a brief
 * scale pulse (plus a success haptic) the moment it does.
 *
 * Fires once per *visit* to a milestone value, not once ever — there is no
 * persisted "already celebrated" flag, on purpose. Checking in again on the
 * same milestone day (a relapse-free streak, an anniversary) should still
 * feel good, not silently do nothing because a flag was already set on a
 * different device.
 *
 * Shared by recovery-hero.tsx (a streak) and together-strip.tsx (days
 * together) — the animation is identical, only what counts as a milestone
 * differs, which is exactly what the `milestones` argument is for.
 */
export function useMilestonePulse(value: number, milestones: readonly number[]) {
  const pulse = useSharedValue(1);
  const lastCelebrated = useRef<number | null>(null);
  const hit = milestones.includes(value);

  useEffect(() => {
    if (!hit || lastCelebrated.current === value) return;
    lastCelebrated.current = value;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    pulse.value = withSequence(
      withTiming(1.08, { duration: 220 }),
      withTiming(1, { duration: 260 }),
    );
  }, [hit, value, pulse]);

  const style = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));
  return { hit, style };
}
