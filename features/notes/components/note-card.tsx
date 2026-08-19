import { Archive, ArchiveRestore, Star, Trash2 } from 'lucide-react-native';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';

import { SwipeableRow } from '@/components/ui/swipeable-row';
import { Text } from '@/components/ui/text';
import { readableTint } from '@/constants/design-tokens';
import { colors } from '@/constants/theme';
import { stripMarkdown } from '@/features/notes/services/markdown';
import { useRelativeTime } from '@/hooks/use-relative-time';
import type { Note } from '@/features/notes/types/note.types';

type Props = {
  note: Note;
  categoryColor?: string;
  /** Take the note rather than closing over it, so the list can hold one stable
   *  handler per action. See the `memo` at the bottom of this file. */
  onPress: (note: Note) => void;
  onDelete: (note: Note) => void;
  onToggleArchive: (note: Note) => void;
};

function NoteCardComponent({ note, categoryColor, onPress, onDelete, onToggleArchive }: Props) {
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const relativeTime = useRelativeTime(new Date(note.updatedAt));

  return (
    <SwipeableRow
      // Swipe-only actions are unreachable by screen readers without these.
      accessibilityActions={[
        { name: 'archive', label: note.isArchived ? t('notes.unarchive') : t('common.archive') },
        { name: 'delete', label: t('common.delete') },
      ]}
      onAccessibilityAction={(name) =>
        name === 'archive' ? onToggleArchive(note) : name === 'delete' ? onDelete(note) : undefined
      }
      actions={
        <>
          <Pressable
            onPress={() => onToggleArchive(note)}
            accessibilityRole="button"
            accessibilityLabel={t(
              note.isArchived ? 'notes.unarchiveNamed' : 'common.archiveNamed',
              {
                name: note.title || t('notes.untitled'),
              },
            )}
            className="flex-1 items-center justify-center bg-secondary"
          >
            {note.isArchived ? (
              <ArchiveRestore color={colors[scheme].foreground} size={18} />
            ) : (
              <Archive color={colors[scheme].foreground} size={18} />
            )}
          </Pressable>
          <Pressable
            onPress={() => onDelete(note)}
            accessibilityRole="button"
            accessibilityLabel={t('common.deleteNamed', {
              name: note.title || t('notes.untitled'),
            })}
            className="flex-1 items-center justify-center bg-destructive"
          >
            <Trash2 color={colors[scheme].primaryForeground} size={18} />
          </Pressable>
        </>
      }
    >
      <Pressable
        onPress={() => onPress(note)}
        accessibilityRole="button"
        accessibilityLabel={note.title || t('notes.untitled')}
        className="gap-1.5 px-4 py-3.5"
      >
        {categoryColor && (
          <View
            className="absolute bottom-2 start-0 top-2 w-1 rounded-full"
            style={{ backgroundColor: readableTint(categoryColor, scheme, 3) }}
          />
        )}
        <View className="flex-row items-center justify-between gap-2">
          <Text className="flex-1 font-sora-semibold" numberOfLines={1}>
            {note.title || t('notes.untitled')}
          </Text>
          {note.isPinned ? (
            <Star size={14} color={colors[scheme].accent} fill={colors[scheme].accent} />
          ) : null}
          <Text variant="caption">{relativeTime}</Text>
        </View>
        {note.body ? (
          <Text variant="muted" numberOfLines={2}>
            {stripMarkdown(note.body)}
          </Text>
        ) : null}
      </Pressable>
    </SwipeableRow>
  );
}

/** Memoised — re-rendered for every keystroke in the notes search field. */
export const NoteCard = memo(NoteCardComponent);
