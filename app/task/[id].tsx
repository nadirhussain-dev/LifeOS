import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import {
  Archive,
  Bell,
  CalendarDays,
  Clock3,
  Flag,
  Repeat,
  StickyNote,
  Tag,
  Trash2,
} from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, Switch, TextInput, View } from 'react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';

import { cardClass } from '@/components/ui/card';
import { ScreenHeader } from '@/components/ui/screen-header';
import { Text } from '@/components/ui/text';
import { colors } from '@/constants/theme';
import { AttributeRow } from '@/components/ui/attribute-row';
import { CategoryPicker } from '@/features/tasks/components/category-picker';
import { DueDateField } from '@/features/tasks/components/due-date-field';
import { PriorityPicker } from '@/features/tasks/components/priority-picker';
import { RecurrencePicker } from '@/features/tasks/components/recurrence-picker';
import { useTask } from '@/features/tasks/hooks/use-task';
import { useTaskMutations } from '@/features/tasks/hooks/use-task-mutations';
import { useKeyboardHeight } from '@/hooks/use-keyboard-height';
import { toDateKey } from '@/lib/date';

const AUTOSAVE_DELAY_MS = 500;

/**
 * Custom header (not the native Stack.Screen header) — SDK 54's Android
 * edge-to-edge changes made the native header's automatic status-bar inset
 * unreliable, overlapping the back button with the system clock. Manual
 * insets.top padding, same as the "new" modal screens, sidesteps it.
 */
export default function TaskDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const keyboardHeight = useKeyboardHeight();
  const { data: task } = useTask(id);
  const { update, archive, remove } = useTaskMutations();

  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (task) {
      setTitle(task.title);
      setNotes(task.notes ?? '');
    }
  }, [task?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!task || title === task.title) return;
    const timeout = setTimeout(
      () => update.mutate({ id: task.id, input: { title } }),
      AUTOSAVE_DELAY_MS,
    );
    return () => clearTimeout(timeout);
  }, [title]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!task || notes === (task.notes ?? '')) return;
    const timeout = setTimeout(
      () => update.mutate({ id: task.id, input: { notes } }),
      AUTOSAVE_DELAY_MS,
    );
    return () => clearTimeout(timeout);
  }, [notes]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!task) return null;

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen options={{ headerShown: false }} />

      <ScreenHeader
        eyebrow={t('tasks.detailTitle')}
        right={
          <View className="flex-row gap-4">
            {task.dueDate && (
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push(`/timeline/${toDateKey(new Date(task.dueDate!))}`)}
                hitSlop={8}
              >
                <Clock3 size={20} color={colors[scheme].foreground} />
              </Pressable>
            )}
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                archive.mutate(task.id);
                router.back();
              }}
              hitSlop={8}
            >
              <Archive size={20} color={colors[scheme].foreground} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                remove.mutate(task.id);
                router.back();
              }}
              hitSlop={8}
            >
              <Trash2 size={20} color={colors[scheme].destructive} />
            </Pressable>
          </View>
        }
      />

      <ScrollView
        contentContainerClassName="gap-6 px-5 pt-3"
        contentContainerStyle={{ paddingBottom: keyboardHeight > 0 ? keyboardHeight + 24 : 32 }}
        keyboardShouldPersistTaps="handled"
      >
        <TextInput
          value={title}
          onChangeText={setTitle}
          multiline
          accessibilityLabel={t('tasks.taskTitle')}
          placeholder={t('tasks.taskTitle')}
          placeholderTextColor={colors[scheme].mutedForeground}
          style={{
            fontSize: 26,
            fontFamily: 'Sora_700Bold',
            lineHeight: 32,
            color: colors[scheme].foreground,
          }}
        />

        <View className={cardClass({ padding: 'none', elevation: 'e1' }, 'px-4')}>
          <AttributeRow icon={Flag} label={t('fields.priority')} isFirst>
            <PriorityPicker
              value={task.priority}
              onChange={(priority) => update.mutate({ id: task.id, input: { priority } })}
            />
          </AttributeRow>

          <AttributeRow icon={CalendarDays} label={t('fields.dueDate')}>
            <DueDateField
              value={task.dueDate}
              hasTime={task.hasDueTime}
              onChange={(dueDate, hasDueTime) =>
                update.mutate({ id: task.id, input: { dueDate, hasDueTime } })
              }
            />
          </AttributeRow>

          {task.dueDate !== null && (
            <AttributeRow icon={Bell} label={t('fields.reminder')}>
              <View className="flex-row items-center justify-between">
                <Text variant="muted">
                  {task.hasDueTime ? t('tasks.notifyAtDueTime') : t('tasks.notifyAtNineAm')}
                </Text>
                <Switch
                  value={task.reminderEnabled}
                  onValueChange={(reminderEnabled) =>
                    update.mutate({ id: task.id, input: { reminderEnabled } })
                  }
                />
              </View>
            </AttributeRow>
          )}

          <AttributeRow icon={Repeat} label={t('fields.repeat')}>
            <RecurrencePicker
              value={task.recurrenceFrequency}
              onChange={(recurrenceFrequency) =>
                update.mutate({ id: task.id, input: { recurrenceFrequency } })
              }
            />
          </AttributeRow>

          <AttributeRow icon={Tag} label={t('fields.category')}>
            <CategoryPicker
              value={task.categoryId}
              onChange={(categoryId) => update.mutate({ id: task.id, input: { categoryId } })}
            />
          </AttributeRow>
        </View>

        <View className="gap-2.5">
          <View className="flex-row items-center gap-1.5">
            <StickyNote size={13} color={colors[scheme].mutedForeground} />
            <Text variant="micro" className="font-sora-semibold">
              {t('fields.notes')}
            </Text>
          </View>
          <TextInput
            value={notes}
            onChangeText={setNotes}
            multiline
            accessibilityLabel={t('tasks.taskNotes')}
            placeholder={t('tasks.addNotes')}
            placeholderTextColor={colors[scheme].mutedForeground}
            className={cardClass(
              { padding: 'md', elevation: 'e1' },
              'min-h-24 text-base text-foreground',
            )}
            textAlignVertical="top"
          />
        </View>
      </ScrollView>
    </View>
  );
}
