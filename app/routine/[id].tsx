import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { ChevronDown, ChevronUp, Plus, Trash2, X } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';

import { cardClass } from '@/components/ui/card';
import { ScreenHeader } from '@/components/ui/screen-header';
import { Text } from '@/components/ui/text';
import { moduleTint } from '@/constants/design-tokens';
import { colors } from '@/constants/theme';
import { useRoutineMutations } from '@/features/habits/hooks/use-routine-mutations';
import { useRoutines } from '@/features/habits/hooks/use-routines';
import { useHabits } from '@/features/habits/hooks/use-habits';

const AUTOSAVE_DELAY_MS = 500;

export default function RoutineDetailScreen() {
  const { id: routineId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();

  const { data: routines = [] } = useRoutines();
  const { data: allHabits = [] } = useHabits();
  const { rename, remove, addHabit, removeHabit, reorder } = useRoutineMutations();

  const routine = routines.find((item) => item.id === routineId);
  const [name, setName] = useState(routine?.name ?? '');

  useEffect(() => {
    if (routine) setName(routine.name);
  }, [routine?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!routine || name === routine.name || !name.trim()) return;
    const timeout = setTimeout(
      () => rename.mutate({ id: routine.id, name: name.trim() }),
      AUTOSAVE_DELAY_MS,
    );
    return () => clearTimeout(timeout);
  }, [name]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!routine) return null;

  const habitIdsInRoutine = new Set(routine.habits.map((habit) => habit.id));
  const availableHabits = allHabits.filter((habit) => !habitIdsInRoutine.has(habit.id));
  const orderedIds = routine.habits.map((habit) => habit.id);

  const move = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= orderedIds.length) return;
    Haptics.selectionAsync();
    const next = [...orderedIds];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    reorder.mutate({ routineId: routine.id, orderedHabitIds: next });
  };

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader
        title={t('habits.editRoutine')}
        eyebrow={t('habits.routine')}
        tint={moduleTint('habit', scheme)}
        actions={[
          {
            icon: Trash2,
            label: t('habits.deleteRoutine'),
            onPress: () => {
              remove.mutate(routine.id);
              router.back();
            },
            tint: colors[scheme].destructive,
          },
        ]}
      />

      <ScrollView
        contentContainerClassName="gap-6 px-5 pt-3 pb-10"
        keyboardShouldPersistTaps="handled"
      >
        <TextInput
          value={name}
          onChangeText={setName}
          accessibilityLabel={t('habits.routineName')}
          placeholder={t('habits.routineName')}
          placeholderTextColor={colors[scheme].mutedForeground}
          style={{ fontSize: 24, fontFamily: 'Sora_700Bold', color: colors[scheme].foreground }}
        />

        <View className="gap-2">
          <Text variant="caption" className="font-sora-semibold uppercase tracking-wide">
            {t('habits.inThisRoutine')}
          </Text>
          {routine.habits.length === 0 ? (
            <Text variant="muted">{t('habits.addHabitsHint')}</Text>
          ) : (
            <View className={cardClass({ padding: 'none' }, 'px-4')}>
              {routine.habits.map((habit, index) => (
                <View
                  key={habit.id}
                  className={
                    index === 0
                      ? 'flex-row items-center gap-3 py-3'
                      : 'flex-row items-center gap-3 border-t border-border py-3'
                  }
                >
                  <Text className="text-lg">{habit.emoji ?? '🔥'}</Text>
                  <Text className="flex-1 font-sora-medium" numberOfLines={1}>
                    {habit.name}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => move(index, -1)}
                    disabled={index === 0}
                    hitSlop={8}
                    className={index === 0 ? 'opacity-30' : ''}
                  >
                    <ChevronUp size={18} color={colors[scheme].mutedForeground} />
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => move(index, 1)}
                    disabled={index === routine.habits.length - 1}
                    hitSlop={8}
                    className={index === routine.habits.length - 1 ? 'opacity-30' : ''}
                  >
                    <ChevronDown size={18} color={colors[scheme].mutedForeground} />
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => removeHabit.mutate({ routineId: routine.id, habitId: habit.id })}
                    hitSlop={8}
                  >
                    <X size={18} color={colors[scheme].destructive} />
                  </Pressable>
                </View>
              ))}
            </View>
          )}
        </View>

        <View className="gap-2">
          <Text variant="caption" className="font-sora-semibold uppercase tracking-wide">
            {t('habits.addAHabit')}
          </Text>
          {availableHabits.length === 0 ? (
            <Text variant="muted">{t('habits.allHabitsInRoutine')}</Text>
          ) : (
            <View className="flex-row flex-wrap gap-2">
              {availableHabits.map((habit) => (
                <Pressable
                  accessibilityRole="button"
                  key={habit.id}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    addHabit.mutate({ routineId: routine.id, habitId: habit.id });
                  }}
                  className="flex-row items-center gap-1.5 rounded-full border border-dashed border-border px-3 py-2"
                >
                  <Text className="text-base">{habit.emoji ?? '🔥'}</Text>
                  <Text variant="caption" className="font-sora-medium">
                    {habit.name}
                  </Text>
                  <Plus size={13} color={colors[scheme].mutedForeground} />
                </Pressable>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}
