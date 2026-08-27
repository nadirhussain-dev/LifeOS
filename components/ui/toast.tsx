import * as Haptics from 'expo-haptics';
import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Pressable, View } from 'react-native';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Check, Info, TriangleAlert, type LucideIcon } from '@/components/ui/icons';
import { Text } from '@/components/ui/text';
import { colors as dsColors, elevation, layout } from '@/constants/design-tokens';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { useToastStore, type ToastVariant } from '@/lib/toast-store';

/**
 * Renders whatever is in the toast store. Mounted once, at the root, above the
 * navigator so it survives screen changes — a toast raised by a delete on a
 * detail screen has to outlive the `router.back()` that follows it, which is
 * exactly the case a screen-local banner gets wrong.
 *
 * Sits above the tab bar rather than over it: covering the primary navigation
 * to report success is a poor trade, and the FAB lives in that corner too.
 */

const ICONS: Record<ToastVariant, LucideIcon> = {
  success: Check,
  error: TriangleAlert,
  info: Info,
};

export function ToastHost() {
  const current = useToastStore((s) => s.current);
  const dismiss = useToastStore((s) => s.dismiss);
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme() ?? 'light';
  const reducedMotion = useReducedMotion();
  const c = dsColors[scheme];
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const id = current?.id;
  const durationMs = current?.durationMs;
  const variant = current?.variant;
  const message = current?.message;

  useEffect(() => {
    if (id === undefined || durationMs === undefined) return;

    // Announce to screen readers: a toast is the entire feedback for an action,
    // and it is invisible to anyone not looking at that corner of the screen.
    if (message) AccessibilityInfo.announceForAccessibility(message);
    if (variant === 'success')
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    if (variant === 'error')
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);

    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => dismiss(id), durationMs);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [id, durationMs, variant, message, dismiss]);

  if (!current) return null;

  const Icon = ICONS[current.variant];
  const accent =
    current.variant === 'success' ? c.success : current.variant === 'error' ? c.error : c.accent;

  return (
    <Animated.View
      // A toast must never intercept a tap meant for the screen behind it, so
      // the wrapper is transparent to touches and only the card itself isn't.
      pointerEvents="box-none"
      entering={reducedMotion ? undefined : FadeInDown.duration(220)}
      exiting={reducedMotion ? undefined : FadeOutDown.duration(160)}
      style={{
        position: 'absolute',
        left: 12,
        right: 12,
        bottom: insets.bottom + layout.tabBarHeight + 12,
      }}
    >
      <View
        accessibilityLiveRegion="polite"
        style={[
          {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            borderRadius: 18,
            paddingVertical: 12,
            paddingHorizontal: 14,
            backgroundColor: c.raised,
            borderWidth: 1,
            borderColor: c.border,
          },
          elevation.e3,
        ]}
      >
        <View
          style={{
            width: 28,
            height: 28,
            borderRadius: 14,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: `${accent}22`,
          }}
        >
          <Icon size={16} color={accent} strokeWidth={2.5} />
        </View>

        <Text className="flex-1 font-sora-medium text-sm text-foreground" numberOfLines={2}>
          {current.message}
        </Text>

        {current.action ? (
          <Pressable
            onPress={() => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              current.action?.onPress();
              dismiss(current.id);
            }}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={current.action.label}
            style={{
              minHeight: layout.minTouchTarget,
              justifyContent: 'center',
              paddingHorizontal: 10,
              marginVertical: -12,
            }}
          >
            <Text className="font-sora-bold text-sm" style={{ color: accent }}>
              {current.action.label}
            </Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={() => dismiss(current.id)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={current.message}
            style={{ width: 24, height: 24, alignItems: 'center', justifyContent: 'center' }}
          >
            <Text variant="caption">✕</Text>
          </Pressable>
        )}
      </View>
    </Animated.View>
  );
}
