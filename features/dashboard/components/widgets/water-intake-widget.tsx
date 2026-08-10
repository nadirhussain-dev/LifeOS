import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { BarChart3, Droplet, GlassWater, Settings2 } from 'lucide-react-native';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
} from 'react-native-reanimated';

import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { moduleTint } from '@/constants/design-tokens';
import { colors } from '@/constants/theme';
import { WidgetCard } from '@/features/dashboard/components/widget-card';
import {
  useTodayWaterTotal,
  useWaterIntakeMutations,
} from '@/features/water-intake/hooks/use-water-intake';
import {
  GLASS_ML,
  useWaterSettingsStore,
} from '@/features/water-intake/store/water-settings-store';

const QUICK_ADD_ML = [500, 1000] as const;

export function WaterIntakeWidget() {
  const { t } = useTranslation();
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const waterTint = moduleTint('water', scheme);
  const goalMl = useWaterSettingsStore((state) => state.goalMl);
  const { data: currentMl, isLoading } = useTodayWaterTotal();
  const { addWater, undoLast } = useWaterIntakeMutations();

  const goalReached = (currentMl ?? 0) >= goalMl;
  const glassCount = Math.round(goalMl / GLASS_ML);
  const filledGlasses = Math.min(Math.round((currentMl ?? 0) / GLASS_ML), glassCount);

  const celebrateScale = useSharedValue(1);
  const wasReached = useRef(false);
  useEffect(() => {
    if (goalReached && !wasReached.current) {
      celebrateScale.value = withSequence(
        withSpring(1.15, { damping: 6, stiffness: 400 }),
        withSpring(1, { damping: 8, stiffness: 300 }),
      );
    }
    wasReached.current = goalReached;
  }, [goalReached, celebrateScale]);
  const celebrateStyle = useAnimatedStyle(() => ({ transform: [{ scale: celebrateScale.value }] }));

  const tapGlass = (index: number) => {
    Haptics.selectionAsync();
    if (index === filledGlasses - 1) undoLast.mutate();
    else if (index >= filledGlasses) addWater.mutate(GLASS_ML);
  };

  const quickAdd = (ml: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    addWater.mutate(ml);
  };

  return (
    <WidgetCard
      icon={GlassWater}
      title={t('dashboard.waterIntake')}
      tint={waterTint}
      actionLabel={t('dashboard.history')}
      onActionPress={() => router.push('/water-intake/history')}
    >
      {isLoading || currentMl === undefined ? (
        <Skeleton className="h-8 w-full" />
      ) : (
        <View className="gap-4">
          <View className="flex-row items-center justify-between">
            <Animated.View style={celebrateStyle}>
              <Text
                variant="muted"
                className="font-sora-semibold"
                style={goalReached ? { color: waterTint } : undefined}
              >
                {currentMl} / {goalMl} ml{goalReached ? ' 🎉' : ''}
              </Text>
            </Animated.View>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/water-intake/settings')}
              hitSlop={8}
              className="h-8 w-8 items-center justify-center rounded-full border border-border bg-surface"
            >
              <Settings2 size={14} color={colors[scheme].mutedForeground} />
            </Pressable>
          </View>

          <View className="flex-row flex-wrap gap-2">
            {Array.from({ length: glassCount }).map((_, index) => {
              const filled = index < filledGlasses;
              return (
                <Pressable
                  accessibilityRole="button"
                  key={index}
                  onPress={() => tapGlass(index)}
                  hitSlop={4}
                  accessibilityLabel={`${index + 1} glass${index === 0 ? '' : 'es'}`}
                  className="h-9 w-9 items-center justify-center rounded-full border"
                  style={{
                    borderColor: filled ? waterTint : colors[scheme].border,
                    backgroundColor: filled ? `${waterTint}1f` : 'transparent',
                  }}
                >
                  <Droplet
                    size={16}
                    color={filled ? waterTint : colors[scheme].mutedForeground}
                    fill={filled ? waterTint : 'transparent'}
                  />
                </Pressable>
              );
            })}
          </View>

          <View className="flex-row gap-2">
            {QUICK_ADD_ML.map((ml) => (
              <Pressable
                accessibilityRole="button"
                key={ml}
                onPress={() => quickAdd(ml)}
                className="flex-1 items-center rounded-full border border-dashed border-border py-2"
              >
                <Text variant="caption" className="font-sora-medium">
                  + {ml >= 1000 ? `${ml / 1000}L bottle` : `${ml}ml`}
                </Text>
              </Pressable>
            ))}
          </View>

          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/water-intake/history')}
            className="flex-row items-center justify-center gap-1.5"
          >
            <BarChart3 size={12} color={colors[scheme].mutedForeground} />
            <Text variant="caption">View last 14 days</Text>
          </Pressable>
        </View>
      )}
    </WidgetCard>
  );
}
