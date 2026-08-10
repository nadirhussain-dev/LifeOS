import { type BottomTabBarProps } from '@react-navigation/bottom-tabs';
import * as Haptics from 'expo-haptics';
import {
  BookOpen,
  CheckSquare,
  Home,
  LayoutGrid,
  Repeat,
  type LucideIcon,
} from 'lucide-react-native';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/text';
import { fontFamily, motion, typography } from '@/constants/design-tokens';
import { colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useReducedMotion } from '@/hooks/use-reduced-motion';

/**
 * The icon, which is the only part of a tab that can move.
 *
 * The label can't: the selected state is carried by font weight as well as
 * colour (the system's "never colour alone" rule), and switching between two
 * static Sora instances re-lays the text out. Sora is only published here as
 * one file per weight — @expo-google-fonts/sora ships 100 through 800 as
 * separate TTFs with no variable axis — so there is no weight to interpolate
 * and no way to make that swap continuous. Animating the icon instead gives
 * the tap somewhere to land without fighting the type.
 */
function TabIcon({ Icon, color, focused }: { Icon: LucideIcon; color: string; focused: boolean }) {
  const reducedMotion = useReducedMotion();
  const scale = useSharedValue(focused ? 1 : 0.92);

  useEffect(() => {
    const target = focused ? 1 : 0.92;
    scale.value = reducedMotion ? target : withSpring(target, motion.spring.press);
  }, [focused, reducedMotion, scale]);

  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Animated.View style={style}>
      <Icon size={22} color={color} strokeWidth={focused ? 2.5 : 2} />
    </Animated.View>
  );
}

/** Per-route identity for the custom bar. Keys match the tab route file names. */
const TABS: Record<string, { labelKey: string; icon: LucideIcon }> = {
  index: { labelKey: 'tabs.home', icon: Home },
  tasks: { labelKey: 'tabs.tasks', icon: CheckSquare },
  habits: { labelKey: 'tabs.habits', icon: Repeat },
  journal: { labelKey: 'tabs.journal', icon: BookOpen },
  hub: { labelKey: 'tabs.more', icon: LayoutGrid },
};

/**
 * A docked, full-width bottom tab bar — each tab shows its icon with the name
 * beneath it (all tabs always labelled), and the active tab is tinted in the
 * brand accent. It sits in the normal layout (not floating) so the navigator
 * reserves its height and insets every screen automatically — content never
 * hides behind it.
 */
export function TabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme() ?? 'light';
  const theme = colors[scheme];
  const accent = theme.accent;
  const { t } = useTranslation();

  return (
    <View
      style={{
        flexDirection: 'row',
        backgroundColor: theme.card,
        borderTopWidth: 1,
        borderTopColor: theme.border,
        paddingTop: 8,
        paddingBottom: Math.max(insets.bottom, 10),
      }}
    >
      {state.routes.map((route, index) => {
        const meta = TABS[route.name];
        if (!meta) return null;
        const focused = state.index === index;
        const Icon = meta.icon;
        const color = focused ? accent : theme.mutedForeground;

        const onPress = () => {
          Haptics.selectionAsync();
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
        };

        return (
          <Pressable
            key={route.key}
            onPress={onPress}
            accessibilityRole="button"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={t(meta.labelKey)}
            style={{
              flex: 1,
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              paddingVertical: 2,
            }}
          >
            <TabIcon Icon={Icon} color={color} focused={focused} />
            <Text
              style={{
                color,
                fontSize: typography.micro.size,
                // Weight, not just colour, carries the selected state — the
                // system's "never colour alone" rule applies to navigation too.
                fontFamily: focused ? fontFamily.bold : fontFamily.medium,
              }}
            >
              {t(meta.labelKey)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
