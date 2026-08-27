import { useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { BookHeart } from '@/components/ui/icons';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { moduleTint } from '@/constants/design-tokens';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { alpha } from '@/lib/color';
import { WidgetCard } from '@/features/dashboard/components/widget-card';
import { useReflect } from '@/features/dashboard/hooks/use-widget-data';
import { useJournalMutations } from '@/features/journal/hooks/use-journal-mutations';
import { toDateKey } from '@/lib/date';
import type { MoodOption } from '@/features/dashboard/types/dashboard.types';

const MOODS: { value: MoodOption; emoji: string }[] = [
  { value: 'great', emoji: '😄' },
  { value: 'good', emoji: '🙂' },
  { value: 'okay', emoji: '😐' },
  { value: 'low', emoji: '😕' },
  { value: 'rough', emoji: '😣' },
];

export function ReflectWidget() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const { data, isLoading, error, refetch } = useReflect();
  const { upsert } = useJournalMutations();
  const todayKey = toDateKey(new Date());

  const selectMood = (mood: MoodOption) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    upsert.mutate({ entryDate: todayKey, mood });
    queryClient.invalidateQueries({ queryKey: ['dashboard', 'reflect'] });
  };

  return (
    <WidgetCard
      error={error}
      onRetry={refetch}
      icon={BookHeart}
      title={t('dashboard.reflect')}
      tint={moduleTint('journal', scheme)}
    >
      {isLoading || !data ? (
        <Skeleton className="h-12 w-full" />
      ) : (
        <View className="gap-4">
          <View className="flex-row justify-between">
            {MOODS.map((mood) => (
              <Pressable
                accessibilityRole="button"
                key={mood.value}
                onPress={() => selectMood(mood.value)}
                className="h-11 w-11 items-center justify-center rounded-full"
                style={
                  data.todaysMood === mood.value
                    ? { backgroundColor: alpha(moduleTint('journal', scheme), 0.16) }
                    : undefined
                }
              >
                <Text className="text-2xl">{mood.emoji}</Text>
              </Pressable>
            ))}
          </View>
          <View className="flex-row items-center justify-between">
            <Text variant="muted">
              🔥 {t('dashboard.journalDayStreak', { count: data.journalStreak })}
            </Text>
            {!data.hasWrittenToday && (
              <Button
                label={t('dashboard.write')}
                size="sm"
                variant="secondary"
                onPress={() => router.push(`/journal/${todayKey}`)}
              />
            )}
          </View>
        </View>
      )}
    </WidgetCard>
  );
}
