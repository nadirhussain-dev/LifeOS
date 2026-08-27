import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { CheckSquare, Square } from '@/components/ui/icons';
import { useColorScheme } from '@/hooks/use-color-scheme';

import { cardClass } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { colors } from '@/constants/theme';
import type { GeneratedTask } from '@/features/notes/types/note.types';

type Props = {
  tasks: GeneratedTask[];
};

/** Tasks created from this note via "Create task" — the note-side view of
 *  `generated_from`, sitting alongside the backlinks panel. */
export function GeneratedTasksPanel({ tasks }: Props) {
  const router = useRouter();
  const { t } = useTranslation();
  const scheme = useColorScheme() ?? 'light';

  if (tasks.length === 0) return null;

  return (
    <View className="gap-2">
      <View className="flex-row items-center gap-1.5">
        <CheckSquare size={13} color={colors[scheme].mutedForeground} />
        <Text variant="sectionLabel">{t('notes.generatedTasks')}</Text>
      </View>
      <View className={cardClass({ padding: 'none' }, 'gap-1 px-4')}>
        {tasks.map((task, index) => {
          const done = task.status === 'completed';
          return (
            <Pressable
              accessibilityRole="button"
              key={task.id}
              onPress={() => router.push(`/task/${task.id}`)}
              className={`flex-row items-center gap-2.5 ${index === 0 ? 'py-3' : 'border-t border-border py-3'}`}
            >
              {done ? (
                <CheckSquare size={16} color={colors[scheme].accent} />
              ) : (
                <Square size={16} color={colors[scheme].mutedForeground} />
              )}
              <Text
                className="font-sora-medium"
                style={
                  done
                    ? { color: colors[scheme].mutedForeground, textDecorationLine: 'line-through' }
                    : undefined
                }
              >
                {task.title}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
