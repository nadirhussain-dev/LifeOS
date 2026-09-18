import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { QueryError } from '@/components/ui/query-error';
import { SheetHeader } from '@/components/ui/sheet-header';
import { HabitForm } from '@/features/habits/components/habit-form';
import { useHabit } from '@/features/habits/hooks/use-habit';
import { useHabitMutations } from '@/features/habits/hooks/use-habit-mutations';
import type { HabitFormValues } from '@/features/habits/schemas/habit-form-schema';

export default function EditHabitScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { t } = useTranslation();
  const habitQuery = useHabit(id);
  const { data: habit } = habitQuery;
  const { update } = useHabitMutations();

  /**
   * A failed read is not a missing subject: this screen edits something it
   * could not fetch, so every field would sit at its default and the form
   * would read as a wiped record. Loading and just-deleted still render
   * nothing — only the failure gets a screen.
   */
  if (!habit) {
    if (habitQuery.isError) {
      return (
        <View className="flex-1 bg-background">
          <SheetHeader title={t('habits.editHabit')} />
          <QueryError error={habitQuery.error} onRetry={() => habitQuery.refetch()} />
        </View>
      );
    }
    return null;
  }

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
