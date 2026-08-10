import { format, parseISO } from 'date-fns';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Archive, Clock3, Pencil, Trash2 } from 'lucide-react-native';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { BottomSheetModal } from '@gorhom/bottom-sheet';

import { cardClass } from '@/components/ui/card';
import { ScreenHeader } from '@/components/ui/screen-header';
import { Text } from '@/components/ui/text';
import { moduleTint } from '@/constants/design-tokens';
import { colors, streakColor } from '@/constants/theme';
import { QuickLogSheet } from '@/features/habits/components/quick-log-sheet';
import { StreakHeatmap } from '@/features/habits/components/streak-heatmap';
import { useHabit, useHabitLogs } from '@/features/habits/hooks/use-habit';
import { useHabitMutations } from '@/features/habits/hooks/use-habit-mutations';
import { calculateHabitStreaks, toDateKey } from '@/features/habits/services/habit-streaks';
import type { HabitWithToday } from '@/features/habits/types/habit.types';

const QUANTIFIED_TYPES = new Set(['count', 'duration', 'distance', 'time']);

export default function HabitDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const quickLogRef = useRef<BottomSheetModal>(null);

  const { data: habit } = useHabit(id);
  const { data: logData } = useHabitLogs(id);
  const { logToday, unlogToday, logDate, archive, remove } = useHabitMutations();

  if (!habit || !logData) return null;

  const { logs, skips } = logData;
  const streaks = calculateHabitStreaks(habit, logs, skips);
  const todayKey = toDateKey(new Date());
  const todayLog = logs.find((log) => log.logDate === todayKey);
  const isQuantified = QUANTIFIED_TYPES.has(habit.type);

  const recentLogs = [...logs].sort((a, b) => b.logDate.localeCompare(a.logDate)).slice(0, 14);

  const habitWithToday: HabitWithToday = {
    ...habit,
    todayStatus: todayLog ? 'done' : 'not_yet',
    todayValue: todayLog?.value ?? null,
    currentStreak: streaks.currentStreak,
    bestStreak: streaks.bestStreak,
  };

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen options={{ headerShown: false }} />

      <ScreenHeader
        eyebrow={t('habits.detailTitle')}
        tint={moduleTint('habit', scheme)}
        right={
          <View className="flex-row gap-4">
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push(`/timeline/${todayKey}`)}
              hitSlop={8}
            >
              <Clock3 size={19} color={colors[scheme].foreground} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push(`/habit/${habit.id}/edit`)}
              hitSlop={8}
            >
              <Pencil size={19} color={colors[scheme].foreground} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => archive.mutate(habit.id)}
              hitSlop={8}
            >
              <Archive size={19} color={colors[scheme].foreground} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                remove.mutate(habit.id);
                router.back();
              }}
              hitSlop={8}
            >
              <Trash2 size={19} color={colors[scheme].destructive} />
            </Pressable>
          </View>
        }
      />

      <ScrollView
        contentContainerClassName="gap-6 px-5 pt-3 pb-10"
        showsVerticalScrollIndicator={false}
      >
        <View className="flex-row items-center gap-3">
          <Text style={{ fontSize: 32 }}>{habit.emoji ?? '🔥'}</Text>
          <Text
            style={{ fontSize: 24, fontFamily: 'Sora_700Bold' }}
            className="flex-1 text-foreground"
          >
            {habit.name}
          </Text>
        </View>

        <View className="flex-row gap-3">
          <View
            className={cardClass(
              { padding: 'none', elevation: 'e1' },
              'flex-1 items-center gap-1 py-4',
            )}
          >
            <Text
              style={{
                fontSize: 28,
                fontFamily: 'Sora_800ExtraBold',
                fontVariant: ['tabular-nums'],
              }}
              className="text-foreground"
            >
              {streaks.currentStreak}
            </Text>
            <Text variant="caption">
              {habit.type === 'negative' ? t('habits.daysWithout') : t('habits.currentStreak')}
            </Text>
            {/* Said out loud rather than hidden. The streak survived a missed
                day, and pretending otherwise would be the app lying to make a
                number look better. */}
            {streaks.graceUsed ? (
              <Text variant="caption" style={{ color: streakColor[scheme] }}>
                {t('habits.streakHeld')}
              </Text>
            ) : null}
          </View>
          <View
            className={cardClass(
              { padding: 'none', elevation: 'e1' },
              'flex-1 items-center gap-1 py-4',
            )}
          >
            <Text
              style={{
                fontSize: 28,
                fontFamily: 'Sora_800ExtraBold',
                fontVariant: ['tabular-nums'],
              }}
              className="text-foreground"
            >
              {streaks.bestStreak}
            </Text>
            <Text variant="caption">{t('habits.bestStreak')}</Text>
          </View>
          <View
            className={cardClass(
              { padding: 'none', elevation: 'e1' },
              'flex-1 items-center gap-1 py-4',
            )}
          >
            <Text
              style={{
                fontSize: 28,
                fontFamily: 'Sora_800ExtraBold',
                fontVariant: ['tabular-nums'],
              }}
              className="text-foreground"
            >
              {Math.round(streaks.completionRate30d * 100)}%
            </Text>
            <Text variant="caption">{t('habits.last30Days')}</Text>
          </View>
        </View>

        {isQuantified ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => quickLogRef.current?.present()}
            className="items-center rounded-2xl bg-success py-3.5"
          >
            <Text className="font-sora-semibold" style={{ color: '#ffffff' }}>
              {todayLog
                ? t('habits.loggedToday', {
                    amount: `${todayLog.value}${habit.unit ? ` ${habit.unit}` : ''}`,
                  })
                : t('habits.logToday')}
            </Text>
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              todayLog ? unlogToday.mutate(habit.id) : logToday.mutate({ habitId: habit.id })
            }
            className={`items-center rounded-2xl py-3.5 ${todayLog ? 'bg-success' : 'bg-surface'}`}
          >
            <Text
              className="font-sora-semibold"
              style={{ color: todayLog ? '#ffffff' : colors[scheme].foreground }}
            >
              {todayLog ? t('habits.doneToday') : t('habits.markDoneToday')}
            </Text>
          </Pressable>
        )}

        <View className="gap-3">
          <Text variant="subheading">{t('habits.consistency')}</Text>
          <StreakHeatmap habit={habit} logs={logs} skips={skips} />
        </View>

        <View className="gap-2">
          <Text variant="subheading">{t('habits.recentHistory')}</Text>
          {recentLogs.length === 0 && <Text variant="muted">{t('habits.noLogsYet')}</Text>}
          {recentLogs.map((log) => (
            <Pressable
              accessibilityRole="button"
              key={log.id}
              onPress={() => router.push(`/timeline/${log.logDate}`)}
              className="flex-row items-center justify-between border-t border-border py-2.5"
            >
              <Text variant="muted">{format(parseISO(log.logDate), 'EEE, MMM d')}</Text>
              <Text className="font-sora-medium">
                {log.value}
                {habit.unit ? ` ${habit.unit}` : ''}
              </Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>

      <QuickLogSheet
        ref={quickLogRef}
        habit={habitWithToday}
        onSubmit={(value) => logDate.mutate({ habitId: habit.id, logDate: todayKey, value })}
      />
    </View>
  );
}
