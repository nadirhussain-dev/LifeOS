import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { SheetHeader } from '@/components/ui/sheet-header';
import { HabitForm } from '@/features/habits/components/habit-form';
import { useHabit } from '@/features/habits/hooks/use-habit';
import { useHabitMutations } from '@/features/habits/hooks/use-habit-mutations';
import type { HabitFormValues } from '@/features/habits/schemas/habit-form-schema';

export default function EditHabitScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { t } = useTranslation();
  const { data: habit } = useHabit(id);
  const { update } = useHabitMutations();

  if (!habit) return null;

  const defaultValues: HabitFormValues = {
    name: habit.name,
    emoji: habit.emoji,
    categoryId: habit.categoryId,
    type: habit.type,
    unit: habit.unit,
    targetValue: habit.targetValue,
    scheduleType: habit.scheduleType,
    scheduleDays: habit.scheduleDays,
    scheduleIntervalDays: habit.scheduleIntervalDays,
    reminderTime: habit.reminderTime,
    reminderAdaptive: habit.reminderAdaptive,
    goalId: habit.goalId,
  };

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen options={{ headerShown: false }} />

      <SheetHeader title={t('habits.editHabit')} />

      <HabitForm
        defaultValues={defaultValues}
        submitLabel={t('habits.saveChanges')}
        onSubmit={(values) => {
          update.mutate({ id: habit.id, input: values });
          router.back();
        }}
      />
    </View>
  );
}
