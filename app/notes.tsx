import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { Archive, Search, StickyNote } from 'lucide-react-native';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, RefreshControl, View } from 'react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';

import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/empty-state';
import { Fab } from '@/components/ui/fab';
import { ListSectionHeader } from '@/components/ui/list-section-header';
import { ScreenHeader } from '@/components/ui/screen-header';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { moduleTints } from '@/constants/design-tokens';
import { colors } from '@/constants/theme';
import { AdSlot } from '@/features/ads/components/ad-slot';
import { NoteCard } from '@/features/notes/components/note-card';
import { useNoteMutations } from '@/features/notes/hooks/use-note-mutations';
import { toast } from '@/lib/toast-store';
import { useArchivedNotes, useNoteCategories, useNotes } from '@/features/notes/hooks/use-notes';
import { useNotesFilterStore } from '@/features/notes/store/notes-filter-store';
import type { Note } from '@/features/notes/types/note.types';

type ListItem = { type: 'header'; label: string; count: number } | { type: 'note'; note: Note };

export default function NotesScreen() {
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const [showArchived, setShowArchived] = useState(false);

  const { searchQuery, setSearchQuery } = useNotesFilterStore();
  const activeNotes = useNotes();
  const archivedNotes = useArchivedNotes();
  const { data: categories = [] } = useNoteCategories();
  const { remove, restore, archive, unarchive } = useNoteMutations();

  // Hoisted, one per action, rather than three closures per card per render.
  // NoteCard is memoised and inline arrows made that memo inert — see its
  // comment. Each takes the note so the identity never has to change.
  const openNote = useCallback((note: Note) => router.push(`/note/${note.id}`), [router]);

  const deleteNote = useCallback(
    ({ id, title }: Note) =>
      remove.mutate(id, {
        onSuccess: () =>
          toast.undo(
            t('notes.deletedToast', { title: title || t('notes.untitled') }),
            t('common.undo'),
            () => restore.mutate(id),
          ),
      }),
    [remove, restore, t],
  );

  const toggleArchiveNote = useCallback(
    (note: Note) => (note.isArchived ? unarchive.mutate(note.id) : archive.mutate(note.id)),
    [archive, unarchive],
  );

  const { data: notes = [], isLoading, refetch } = showArchived ? archivedNotes : activeNotes;

  // Pull-to-refresh existed on the dashboard and nowhere else, so the reflex
  // gesture did nothing on every list in the app.
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);
  const categoryColorById = useMemo(
    () => new Map(categories.map((category) => [category.id, category.colorToken])),
    [categories],
  );

  const items = useMemo<ListItem[]>(() => {
    if (showArchived) return notes.map((note) => ({ type: 'note', note }) as const);

    const pinned = notes.filter((note) => note.isPinned);
    const rest = notes.filter((note) => !note.isPinned);
    const sections: ListItem[] = [];
    if (pinned.length > 0) {
      sections.push({ type: 'header', label: t('notes.pinned'), count: pinned.length });
      sections.push(...pinned.map((note) => ({ type: 'note', note }) as const));
    }
    if (rest.length > 0) {
      if (pinned.length > 0)
        sections.push({ type: 'header', label: t('notes.allNotes'), count: rest.length });
      sections.push(...rest.map((note) => ({ type: 'note', note }) as const));
    }
    return sections;
  }, [notes, showArchived, t]);

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader
        title={t('notes.title')}
        eyebrow={t('notes.capture')}
        tint={moduleTints.notes}
        right={
          <Pressable
            accessibilityRole="button"
            onPress={() => setShowArchived((current) => !current)}
            className="flex-row items-center gap-1.5 rounded-full border border-border px-3 py-1.5"
          >
            <Archive size={13} color={colors[scheme].mutedForeground} />
            <Text variant="caption">{showArchived ? t('notes.active') : t('notes.archived')}</Text>
          </Pressable>
        }
      />
      <View className="px-5 pb-3 pt-3">
        <View className="flex-row items-center gap-2 rounded-full border border-border bg-surface px-4 py-2.5">
          <Search size={16} color={colors[scheme].mutedForeground} />
          <Input
            surface="bare"
            value={searchQuery}
            onChangeText={setSearchQuery}
            accessibilityLabel={t('notes.searchNotes')}
            placeholder={t('notes.searchNotes')}
            className="flex-1 text-foreground"
          />
        </View>
      </View>

      {isLoading ? (
        <View className="gap-2.5 px-5">
          <Skeleton className="h-16 w-full rounded-2xl" />
          <Skeleton className="h-16 w-full rounded-2xl" />
          <Skeleton className="h-16 w-full rounded-2xl" />
        </View>
      ) : items.length === 0 ? (
        <EmptyState
          icon={StickyNote}
          title={showArchived ? t('notes.emptyArchived') : t('notes.emptyTitle')}
          description={showArchived ? t('notes.emptyArchivedBody') : t('notes.emptyBody')}
        />
      ) : (
        <FlashList
          data={items}
          keyExtractor={(item) => (item.type === 'header' ? `header-${item.label}` : item.note.id)}
          contentContainerStyle={{ paddingTop: 4, paddingBottom: 120 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              // Without an explicit tint the spinner is invisible on dark.
              tintColor={colors[scheme].mutedForeground}
              colors={[colors[scheme].accent]}
            />
          }
          renderItem={({ item }) =>
            item.type === 'header' ? (
              <ListSectionHeader label={item.label} count={item.count} />
            ) : (
              <NoteCard
                note={item.note}
                categoryColor={
                  item.note.categoryId ? categoryColorById.get(item.note.categoryId) : undefined
                }
                onPress={openNote}
                onDelete={deleteNote}
                onToggleArchive={toggleArchiveNote}
              />
            )
          }
          ListFooterComponent={
            <View className="px-5 pt-4">
              <AdSlot placement="notes-bottom" />
            </View>
          }
        />
      )}

      <Fab onPress={() => router.push('/note/new')} accessibilityLabel={t('notes.addNote')} />
    </View>
  );
}
