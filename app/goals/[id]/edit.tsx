import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { QueryError } from '@/components/ui/query-error';
import { SheetHeader } from '@/components/ui/sheet-header';
import { GoalForm } from '@/features/goals/components/goal-form';
import { useGoal } from '@/features/goals/hooks/use-goals';
import { useGoalMutations } from '@/features/goals/hooks/use-goal-mutations';
import { type GoalFormValues } from '@/features/goals/schemas/goal-form-schema';

export default function EditGoalScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { t } = useTranslation();
  const goalQuery = useGoal(id);
  const { data: goal } = goalQuery;
  const { update } = useGoalMutations();

  /**
   * A failed read is not a missing subject: this screen edits something it
   * could not fetch, so every field would sit at its default and the form
   * would read as a wiped record. Loading and just-deleted still render
   * nothing — only the failure gets a screen.
   */
  if (!goal) {
    if (goalQuery.isError) {
      return (
        <View className="flex-1 bg-background">
          <SheetHeader title={t('goals.editGoal')} />
          <QueryError error={goalQuery.error} onRetry={() => goalQuery.refetch()} />
        </View>
      );
    }
    return null;
  }

  const defaults: GoalFormValues = {
    title: goal.title,
    description: goal.description,
    category: goal.category,
    categoryLabel: goal.categoryLabel,
    priority: goal.priority,
    progressMode: goal.progressMode,
    targetValue: goal.targetValue,
    unit: goal.unit,
    dueDate: goal.dueDate,
    milestones: [],
  };

  return (
    <View className="flex-1 bg-background">
      <SheetHeader title={t('goals.editGoal')} />

      <GoalForm
        defaultValues={defaults}
        submitLabel={t('common.saveChanges')}
        showMilestones={false}
        onSubmit={(values) => {
          update.mutate({
            id: goal.id,
            input: {
              title: values.title,
              description: values.description,
              category: values.category,
              categoryLabel: values.categoryLabel,
              priority: values.priority,
              progressMode: values.progressMode,
              targetValue: values.targetValue,
              unit: values.unit,
              dueDate: values.dueDate,
            },
          });
          router.back();
        }}
      />
    </View>
  );
}
