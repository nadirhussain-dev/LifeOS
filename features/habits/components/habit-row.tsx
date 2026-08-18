import * as Haptics from 'expo-haptics';
import { Archive, Check, Flame, Plus, Trash2 } from 'lucide-react-native';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';

import { SwipeableRow } from '@/components/ui/swipeable-row';
import { Text } from '@/components/ui/text';
import { readableTint } from '@/constants/design-tokens';
import { colors, streakColor } from '@/constants/theme';
import type { HabitWithToday } from '@/features/habits/types/habit.types';

type Props = {
  habit: HabitWithToday;
  /** Take the habit rather than closing over it, so the list can hold one
   *  stable handler per action. See the `memo` at the bottom of this file. */
  onPress: (habit: HabitWithToday) => void;
  onToggleDone: (habit: HabitWithToday) => void;
  onQuickLog: (habit: HabitWithToday) => void;
  onArchive: (habit: HabitWithToday) => void;
  onDelete: (habit: HabitWithToday) => void;
};

const QUANTIFIED_TYPES = new Set(['count', 'duration', 'distance', 'time']);

function HabitRowComponent({
  habit,
  onPress,
  onToggleDone,
  onQuickLog,
  onArchive,
  onDelete,
}: Props) {
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const isDone = habit.todayStatus === 'done';
  const isQuantified = QUANTIFIED_TYPES.has(habit.type);
  const tint = habit.colorToken ?? colors[scheme].accent;
  const flame = streakColor[scheme];

  const handleToggle = () => {
    void Haptics.impactAsync(
      isDone ? Haptics.ImpactFeedbackStyle.Light : Haptics.ImpactFeedbackStyle.Medium,
    );
    onToggleDone(habit);
  };

  // Was two hardcoded English template strings, so the streak read in English
  // regardless of language — and the count wasn't pluralised at all.
  const streakLabel =
    habit.type === 'negative'
      ? t('habits.withoutDays', { count: habit.currentStreak })
      : t('habits.streakDays', { count: habit.currentStreak });

  return (
    <SwipeableRow
      // Archive and delete were reachable only by swiping, which a screen
      // reader cannot perform — so for those users the actions did not exist.
      accessibilityActions={[
        { name: 'archive', label: t('common.archive') },
        { name: 'delete', label: t('common.delete') },
      ]}
      onAccessibilityAction={(name) =>
        name === 'archive' ? onArchive(habit) : name === 'delete' ? onDelete(habit) : undefined
      }
      actions={
        <>
          <Pressable
            onPress={() => onArchive(habit)}
            accessibilityRole="button"
            accessibilityLabel={t('common.archiveNamed', { name: habit.name })}
            className="flex-1 items-center justify-center bg-secondary"
          >
            <Archive color={colors[scheme].foreground} size={18} />
          </Pressable>
          <Pressable
            onPress={() => onDelete(habit)}
            accessibilityRole="button"
            accessibilityLabel={t('common.deleteNamed', { name: habit.name })}
            className="flex-1 items-center justify-center bg-destructive"
          >
            <Trash2 color={colors[scheme].primaryForeground} size={18} />
          </Pressable>
        </>
      }
    >
      <Pressable
        onPress={() => onPress(habit)}
        accessibilityRole="button"
        accessibilityLabel={habit.name}
        className="flex-row items-center gap-3 px-4 py-3"
      >
        <View
          className="h-11 w-11 items-center justify-center rounded-full"
          style={{ backgroundColor: `${tint}1f` }}
        >
          <Text className="text-xl">{habit.emoji ?? '🔥'}</Text>
        </View>

        <View className="flex-1 gap-1">
          <Text className="font-sora-medium" numberOfLines={1}>
            {habit.name}
          </Text>
          {habit.currentStreak > 0 && (
            <View className="flex-row items-center gap-1">
              {/* Flame keeps the amber; the label uses the darkened form —
                  amber on the light ground was 2.06:1. */}
              <Flame size={12} color={flame} fill={flame} />
              <Text variant="caption" style={{ color: flame }} className="font-sora-medium">
                {streakLabel}
              </Text>
            </View>
          )}
        </View>

        {isQuantified ? (
          <Pressable
            onPress={() => {
              void Haptics.selectionAsync();
              onQuickLog(habit);
            }}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={t('habits.quickLog', { name: habit.name })}
            className="flex-row items-center gap-1 rounded-full border border-border px-3 py-1.5"
            style={{ minHeight: 36 }}
          >
            {habit.todayValue ? (
              <Text
                variant="caption"
                className="font-sora-medium"
                style={{ color: readableTint(tint, scheme) }}
              >
                {habit.todayValue}
                {habit.unit ? ` ${habit.unit}` : ''}
              </Text>
            ) : null}
            <Plus size={14} color={colors[scheme].mutedForeground} />
          </Pressable>
        ) : (
          <Pressable
            onPress={handleToggle}
            hitSlop={8}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: isDone }}
            accessibilityLabel={t(isDone ? 'common.markNotDone' : 'common.markDone', {
              name: habit.name,
            })}
            className={`h-9 w-9 items-center justify-center rounded-full border ${
              isDone ? 'border-success bg-success' : 'border-border'
            }`}
          >
            {isDone ? <Check size={17} color="#ffffff" /> : null}
          </Pressable>
        )}
      </Pressable>
    </SwipeableRow>
  );
}

/** Memoised — the habits screen re-renders the whole list on every search
 *  keystroke, and each row mounts its own gesture handler. */
export const HabitRow = memo(HabitRowComponent);
