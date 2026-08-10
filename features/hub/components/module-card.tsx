import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { cardClass } from '@/components/ui/card';
import { Sparkline } from '@/components/ui/sparkline';
import { Text } from '@/components/ui/text';
import type { HubModule } from '@/features/hub/config/modules';
import { useTheme } from '@/hooks/use-theme';
import { alpha } from '@/lib/color';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** Roughly half the grid width at the app's gutters — enough for the trend to
 *  bleed edge to edge without measuring on every render. */
const SPARK_WIDTH = 190;
const SPARK_HEIGHT = 44;

type Props = {
  module: HubModule;
  onPress: (module: HubModule) => void;
  /**
   * Recent activity for this module, oldest first, for the trend that fills
   * the tile's lower half. Omit and the tile simply has none — a module with
   * no history should not invent a shape.
   */
  trend?: number[];
};

/**
 * One tile in the Hub grid.
 *
 * This used to be a saturated gradient fill with a frosted icon chip and two
 * white "orbs" for depth. Three things were wrong with it.
 *
 * It was the app's only real visual spend, and it was spent on decoration: the
 * orbs carry no information, and the gradient's only job was to look
 * expensive. The rest of the app is a calm spatial system; the Hub was a
 * different product.
 *
 * It leaned entirely on hue for identity, and hue has run out. There are
 * sixteen tints on a 360° wheel and the system's own rule asks for 30°
 * separation, which allows twelve — habit and recovery are 5° apart, so are
 * journal and study, so are fitness and intimacy (see the crowding table in
 * docs/design-system.md). Two tiles reading as "the same green" is not a
 * colour-picking mistake, it is arithmetic, and no amount of retuning fixes
 * it. Identity has to come from somewhere else as well.
 *
 * So the tile now shows the module's own data. A trend line bleeds off both
 * edges under a soft wash of the tint; the icon and title sit on the card
 * surface in normal foreground. The tint is still there and still identifies
 * the module, but it is doing 12% of the work instead of 100%, and the shape
 * of the line — flat, climbing, spiky — distinguishes two same-hue modules
 * instantly in a way two greens never could.
 *
 * It also fixes the contrast problem the gradient created. White-on-tint
 * failed AA on thirteen of sixteen tints and needed the gradient darkened
 * 20–36% to compensate; text on `bg-card` in `text-foreground` clears AAA
 * everywhere and needs no compensation at all.
 */
export function ModuleCard({ module, onPress, trend }: Props) {
  const { t } = useTranslation();
  const { resolve } = useTheme();
  const { icon: Icon, titleKey, subtitleKey, status } = module;
  const tint = resolve(module.tint);
  const isReady = status === 'ready';

  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const handlePress = () => {
    if (!isReady) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress(module);
  };

  const body = (
    <>
      <View className="flex-row items-start justify-between">
        <View
          className="h-11 w-11 items-center justify-center rounded-2xl"
          style={{ backgroundColor: alpha(tint, isReady ? 0.16 : 0.1) }}
        >
          <Icon color={tint} size={22} strokeWidth={2.1} />
        </View>
        {!isReady && (
          <View className="rounded-full bg-muted px-2 py-0.5">
            <Text className="font-sora-semibold text-[10px] uppercase tracking-wide text-muted-foreground">
              {t('hub.soon')}
            </Text>
          </View>
        )}
      </View>

      <View className="mt-auto gap-0.5">
        <Text className="font-sora-bold text-base text-foreground">{t(titleKey)}</Text>
        <Text variant="caption" numberOfLines={1}>
          {t(subtitleKey)}
        </Text>
      </View>
    </>
  );

  if (!isReady) {
    return (
      <View
        className={cardClass({ padding: 'md' }, 'flex-1 gap-3')}
        style={{ opacity: 0.55, minHeight: 130 }}
      >
        {body}
      </View>
    );
  }

  return (
    <AnimatedPressable
      onPress={handlePress}
      onPressIn={() => (scale.value = withTiming(0.96, { duration: 90 }))}
      onPressOut={() => (scale.value = withTiming(1, { duration: 90 }))}
      accessibilityRole="button"
      accessibilityLabel={t(titleKey)}
      accessibilityHint={t('hub.openHint', { title: t(titleKey) })}
      style={[animatedStyle, { flex: 1 }]}
    >
      <View
        className={cardClass({ padding: 'md', elevation: 'e1' }, 'flex-1 gap-3 overflow-hidden')}
        style={{ minHeight: 130 }}
      >
        {/* The trend sits behind the content, bleeding off both edges, so the
            card reads as a surface with data in it rather than a chart in a box. */}
        {trend && trend.length > 1 ? (
          <View
            pointerEvents="none"
            style={{ position: 'absolute', left: 0, right: 0, bottom: 0, opacity: 0.9 }}
          >
            <Sparkline data={trend} tint={tint} width={SPARK_WIDTH} height={SPARK_HEIGHT} />
          </View>
        ) : (
          // No history yet: a whisper of the tint along the bottom edge keeps
          // the module identifiable without drawing a line that means nothing.
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              height: 3,
              backgroundColor: alpha(tint, 0.35),
            }}
          />
        )}
        <View style={{ flex: 1, backgroundColor: 'transparent' }}>{body}</View>
      </View>
    </AnimatedPressable>
  );
}

/** Kept so the Hub can tint its own scrim to the pressed module if it wants. */
export const moduleCardSurface = (tint: string, theme: 'light' | 'dark') =>
  alpha(tint, theme === 'dark' ? 0.1 : 0.07);
