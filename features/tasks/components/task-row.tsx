import { format, isToday } from 'date-fns';
import * as Haptics from 'expo-haptics';
import { Archive, Check, ListChecks, Trash2 } from 'lucide-react-native';
import { memo, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
} from 'react-native-reanimated';

import { SwipeableRow } from '@/components/ui/swipeable-row';
import { Text } from '@/components/ui/text';
import { colors, priorityColors } from '@/constants/theme';
import { getDueBucket } from '@/features/tasks/services/task-grouping';
import type { Task } from '@/features/tasks/types/task.types';

type Props = {
  task: Task;
  /** Checklist totals, passed as two primitives rather than one object: this
   *  component is memoised, and a fresh `{ done, total }` on every parent
   *  render would defeat that for every row in the list. */
  checklistDone?: number;
  checklistTotal?: number;
  /** These take the task rather than closing over it, so a list can hold one
   *  stable handler per action instead of allocating four closures per row on
   *  every render. That is what makes the `memo` below do anything — see its
   *  comment. */
  onPress: (task: Task) => void;
  onToggleComplete: (task: Task) => void;
  onArchive: (task: Task) => void;
  onDelete: (task: Task) => void;
};

function DueDateLabel({ task }: { task: Task }) {
  const { t } = useTranslation();
  if (!task.dueDate) return null;
  const bucket = getDueBucket(task);
  const variant =
    bucket === 'overdue'
      ? 'text-destructive'
      : bucket === 'today'
        ? 'text-foreground'
        : 'text-muted-foreground';
  return (
    <Text className={`font-sora-medium text-xs ${variant}`}>
      {isToday(task.dueDate) ? t('common.today') : format(task.dueDate, 'MMM d')}
    </Text>
  );
}

function TaskRowComponent({
  task,
  checklistDone = 0,
  checklistTotal = 0,
  onPress,
  onToggleComplete,
  onArchive,
  onDelete,
}: Props) {
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const isCompleted = task.status === 'completed';
  const scale = useSharedValue(1);
  const isMounted = useRef(false);
  const accentColor = task.priority !== 'none' ? priorityColors[task.priority] : undefined;

  useEffect(() => {
    if (!isMounted.current) {
      isMounted.current = true;
      return;
    }
    // Pop outward then settle — a small, satisfying "done" beat rather than
    // an instant color swap. Skipped on mount so rows don't all pop when a
    // list first loads.
    scale.value = withSequence(
      withSpring(1.3, { damping: 8, stiffness: 400 }),
      withSpring(1, { damping: 10, stiffness: 300 }),
    );
  }, [isCompleted, scale]);

  const checkboxStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const handleToggle = () => {
    Haptics.impactAsync(
      isCompleted ? Haptics.ImpactFeedbackStyle.Light : Haptics.ImpactFeedbackStyle.Medium,
    );
    onToggleComplete(task);
  };

  return (
    <SwipeableRow
      accessibilityActions={[
        { name: 'archive', label: t('common.archive') },
        { name: 'delete', label: t('common.delete') },
      ]}
      onAccessibilityAction={(name) =>
        name === 'archive' ? onArchive(task) : name === 'delete' ? onDelete(task) : undefined
      }
      actions={
        <>
          <Pressable
            accessibilityRole="button"
            onPress={() => onArchive(task)}
            accessibilityLabel={t('common.archiveNamed', { name: task.title })}
            className="flex-1 items-center justify-center bg-secondary"
          >
            <Archive color={colors[scheme].foreground} size={18} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => onDelete(task)}
            accessibilityLabel={t('common.deleteNamed', { name: task.title })}
            className="flex-1 items-center justify-center bg-destructive"
          >
            <Trash2 color={colors[scheme].primaryForeground} size={18} />
          </Pressable>
        </>
      }
    >
      <Pressable
        accessibilityRole="button"
        onPress={() => onPress(task)}
        className="flex-row items-center gap-3 px-4 py-3.5"
      >
        {accentColor && (
          <View
            className="absolute bottom-2 start-0 top-2 w-1 rounded-full"
            style={{ backgroundColor: accentColor }}
          />
        )}
        <Pressable
          onPress={handleToggle}
          hitSlop={8}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: isCompleted }}
          accessibilityLabel={t(isCompleted ? 'common.markNotDone' : 'common.markDone', {
            name: task.title,
          })}
        >
          <Animated.View style={checkboxStyle}>
            <View
              className="h-7 w-7 items-center justify-center rounded-full border"
              style={{
                borderColor: isCompleted ? colors[scheme].accent : colors[scheme].border,
                backgroundColor: isCompleted ? colors[scheme].accent : 'transparent',
              }}
            >
              {isCompleted ? <Check size={15} color={colors[scheme].accentForeground} /> : null}
            </View>
          </Animated.View>
        </Pressable>

        <View className="flex-1 gap-1">
          <Text
            className={
              isCompleted
                ? 'font-sora-medium text-muted-foreground line-through'
                : 'font-sora-medium'
            }
            numberOfLines={1}
          >
            {task.title}
          </Text>
          <View className="flex-row items-center gap-2">
            <DueDateLabel task={task} />
            {checklistTotal > 0 && (
              <View className="flex-row items-center gap-1">
                <ListChecks size={11} color={colors[scheme].mutedForeground} />
                <Text variant="micro" className="text-muted-foreground">
                  {checklistDone}/{checklistTotal}
                </Text>
              </View>
            )}
          </View>
        </View>
      </Pressable>
    </SwipeableRow>
  );
}

/**
 * Memoised: these rows carry their own Reanimated hooks, and every keystroke in
 * the list's search field re-rendered all of them.
 *
 * The memo only earns that if its props are referentially stable. It was added
 * while the list still passed `onPress={() => router.push(...)}` and three more
 * inline arrows per row, so every parent render allocated four fresh functions,
 * every prop comparison failed, and the memo re-rendered the whole list exactly
 * as before while looking like it had fixed the problem. The handlers now take
 * the task, so the list holds one `useCallback` per action.
 */
export const TaskRow = memo(TaskRowComponent);
