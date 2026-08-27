import { useEffect } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { X } from '@/components/ui/icons';
import { Text } from '@/components/ui/text';
import { useDevErrorStore } from '@/lib/dev-error-store';

const AUTO_DISMISS_MS = 10_000;

/** Dev-only banner — see lib/query-client.ts for where errors get reported here. */
export function DevErrorBanner() {
  const message = useDevErrorStore((state) => state.message);
  const clear = useDevErrorStore((state) => state.clear);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (!message) return;
    const timeout = setTimeout(clear, AUTO_DISMISS_MS);
    return () => clearTimeout(timeout);
  }, [message, clear]);

  if (!__DEV__ || !message) return null;

  return (
    <Animated.View
      entering={FadeInUp.duration(200)}
      exiting={FadeOutUp.duration(150)}
      style={{ paddingTop: insets.top + 8 }}
      className="absolute inset-x-0 top-0 z-50 bg-destructive px-4 pb-3"
    >
      <View className="flex-row items-start gap-2">
        <Text className="flex-1 text-sm" style={{ color: '#ffffff' }}>
          {message}
        </Text>
        <Pressable accessibilityRole="button" onPress={clear} hitSlop={8}>
          <X size={16} color="#ffffff" />
        </Pressable>
      </View>
    </Animated.View>
  );
}
