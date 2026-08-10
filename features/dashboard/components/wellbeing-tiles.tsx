import { useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { BookHeart, Droplet } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { moduleTint } from '@/constants/design-tokens';
import { colors } from '@/constants/theme';
import { useReflect } from '@/features/dashboard/hooks/use-widget-data';
import { useJournalMutations } from '@/features/journal/hooks/use-journal-mutations';
import {
  useTodayWaterTotal,
  useWaterIntakeMutations,
} from '@/features/water-intake/hooks/use-water-intake';
import {
  GLASS_ML,
  useWaterSettingsStore,
} from '@/features/water-intake/store/water-settings-store';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { alpha } from '@/lib/color';
import { toDateKey } from '@/lib/date';
import type { MoodOption } from '@/features/dashboard/types/dashboard.types';

const MAX_SEGMENTS = 8;

/**
 * The Wellbeing zone renders two compact tiles side-by-side instead of two
 * full-width cards — the size change is what gives the dashboard rhythm rather
 * than one monotonous column. Both stay genuinely interactive: the water tile
 * adds a glass on tap, the mood tile logs today's mood.
 */

/** Shared half-width tile shell — a resting card that floats on e1. */
function tileClass() {
  return 'flex-1 gap-3 rounded-2xl border border-border bg-card p-4 shadow-e1';
}

export function WaterTile() {
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const tint = moduleTint('water', scheme);
  const goalMl = useWaterSettingsStore((state) => state.goalMl);
  const { data: currentMl } = useTodayWaterTotal();
  const { addWater } = useWaterIntakeMutations();

  const current = currentMl ?? 0;
  const segments = Math.min(Math.max(Math.round(goalMl / GLASS_ML), 1), MAX_SEGMENTS);
  const perSegment = goalMl / segments;
  const filled = Math.min(Math.round(current / perSegment), segments);

  const addGlass = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    addWater.mutate(GLASS_ML);
  };

  return (
    <Pressable
      accessibilityRole="button"
      onPress={addGlass}
      className={tileClass()}
      accessibilityLabel={t('dashboard.addGlassOfWater')}
    >
      <View
        className="h-8 w-8 items-center justify-center rounded-xl"
        style={{ backgroundColor: alpha(tint, 0.14) }}
      >
        <Droplet size={17} color={tint} />
      </View>
      <View>
        <Text className="font-sora-extrabold text-xl text-foreground">
          {(current / 1000).toFixed(1)}
          <Text variant="caption"> / {(goalMl / 1000).toFixed(1)} L</Text>
        </Text>
        <Text variant="caption">{t('dashboard.tapToAddGlass')}</Text>
      </View>
      <View className="flex-row gap-1">
        {Array.from({ length: segments }).map((_, i) => (
          <View
            key={i}
            className="h-5 flex-1 rounded"
            style={{ backgroundColor: i < filled ? tint : colors[scheme].muted }}
          />
        ))}
      </View>
    </Pressable>
  );
}

const MOODS: { value: MoodOption; emoji: string }[] = [
  { value: 'great', emoji: '😄' },
  { value: 'good', emoji: '🙂' },
  { value: 'okay', emoji: '😐' },
  { value: 'low', emoji: '😕' },
  { value: 'rough', emoji: '😣' },
];

export function MoodTile() {
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const tint = moduleTint('journal', scheme);
  const queryClient = useQueryClient();
  const { data } = useReflect();
  const { upsert } = useJournalMutations();
  const todayKey = toDateKey(new Date());

  const selectMood = (mood: MoodOption) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    upsert.mutate({ entryDate: todayKey, mood });
    queryClient.invalidateQueries({ queryKey: ['dashboard', 'reflect'] });
  };

  return (
    <View className={tileClass()}>
      <View
        className="h-8 w-8 items-center justify-center rounded-xl"
        style={{ backgroundColor: alpha(tint, 0.14) }}
      >
        <BookHeart size={17} color={tint} />
      </View>
      <View>
        <Text className="font-sora-semibold text-foreground">{t('dashboard.howAreYou')}</Text>
        <Text variant="caption">
          🔥 {t('dashboard.dayStreak', { count: data?.journalStreak ?? 0 })}
        </Text>
      </View>
      <View className="flex-row">
        {MOODS.map((mood) => (
          <Pressable
            accessibilityRole="button"
            key={mood.value}
            onPress={() => selectMood(mood.value)}
            hitSlop={6}
            className="flex-1 items-center justify-center rounded-full py-1.5"
            style={
              data?.todaysMood === mood.value ? { backgroundColor: alpha(tint, 0.16) } : undefined
            }
          >
            <Text className="text-lg">{mood.emoji}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
