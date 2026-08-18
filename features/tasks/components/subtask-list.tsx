import * as Haptics from 'expo-haptics';
import { Check, ListChecks, Plus, X } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, TextInput, View } from 'react-native';

import { ProgressBar } from '@/components/ui/progress-bar';
import { Text } from '@/components/ui/text';
import { colors } from '@/constants/theme';
import { useSubtaskMutations, useSubtasks } from '@/features/tasks/hooks/use-subtasks';
import { subtaskProgress } from '@/features/tasks/services/subtask-progress';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { cn } from '@/lib/utils';

type Props = { taskId: string };

/**
 * A task's checklist: progress, the items, and one row for adding another.
 *
 * The add field stays mounted and keeps focus after each submit, because a
 * checklist is written in a burst — five items in ten seconds — and a field
 * that dismisses the keyboard between each one turns that into five taps of
 * the "add" button as well.
 */
export function SubtaskList({ taskId }: Props) {
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const { data: subtasks = [] } = useSubtasks(taskId);
  const { toggle, add, remove } = useSubtaskMutations(taskId);
  const [draft, setDraft] = useState('');

  const progress = subtaskProgress(subtasks);

  const submit = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    Haptics.selectionAsync();
    add.mutate(trimmed);
    setDraft('');
  };

  return (
    <View className="gap-2.5">
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center gap-1.5">
          <ListChecks size={13} color={colors[scheme].mutedForeground} />
          <Text variant="micro" className="font-sora-semibold">
            {t('tasks.checklist')}
          </Text>
        </View>
        {progress.total > 0 && (
          <Text variant="micro" className="text-muted-foreground">
            {t('tasks.checklistProgress', { done: progress.done, total: progress.total })}
          </Text>
        )}
      </View>

      {progress.total > 0 && <ProgressBar progress={progress.ratio} />}

      <View>
        {subtasks.map((subtask) => (
          <View key={subtask.id} className="flex-row items-center gap-3 py-2">
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: subtask.isDone }}
              accessibilityLabel={subtask.title}
              hitSlop={8}
              onPress={() => {
                Haptics.selectionAsync();
                toggle.mutate({ id: subtask.id, isDone: !subtask.isDone });
              }}
              style={
                subtask.isDone
                  ? { backgroundColor: colors[scheme].accent, borderColor: colors[scheme].accent }
                  : undefined
              }
              className={cn(
                'h-5 w-5 items-center justify-center rounded-md border',
                !subtask.isDone && 'border-border',
              )}
            >
              {subtask.isDone && <Check size={13} color={colors[scheme].accentForeground} />}
            </Pressable>

            <Text className={cn('flex-1', subtask.isDone && 'text-muted-foreground line-through')}>
              {subtask.title}
            </Text>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('tasks.removeChecklistItem', { title: subtask.title })}
              hitSlop={8}
              onPress={() => {
                Haptics.selectionAsync();
                remove.mutate(subtask.id);
              }}
            >
              <X size={15} color={colors[scheme].mutedForeground} />
            </Pressable>
          </View>
        ))}
      </View>

      <View className="flex-row items-center gap-3">
        <Plus size={15} color={colors[scheme].mutedForeground} />
        <TextInput
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={submit}
          // Keeps the keyboard up so a burst of items is one flow rather than
          // a tap-type-dismiss cycle per line.
          blurOnSubmit={false}
          returnKeyType="next"
          accessibilityLabel={t('tasks.addChecklistItem')}
          placeholder={t('tasks.addChecklistItem')}
          placeholderTextColor={colors[scheme].mutedForeground}
          className="flex-1 py-2 text-base text-foreground"
        />
      </View>
    </View>
  );
}
