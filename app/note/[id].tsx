import { useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import {
  Archive,
  ArchiveRestore,
  Bell,
  FileQuestion,
  ListPlus,
  Star,
  Tag,
  Tags,
  Trash2,
} from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';

import { Input } from '@/components/ui/input';
import { cardClass } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { QueryError } from '@/components/ui/query-error';
import { Skeleton } from '@/components/ui/skeleton';
import { AttachmentStrip } from '@/components/ui/attachment-strip';
import { AttributeRow } from '@/components/ui/attribute-row';
import { ReminderPicker } from '@/components/ui/reminder-picker';
import { ScreenHeader } from '@/components/ui/screen-header';
import { VoiceNoteRecorder } from '@/components/ui/voice-note-recorder';
import { moduleTints } from '@/constants/design-tokens';
import { colors } from '@/constants/theme';
import { BacklinksPanel } from '@/features/notes/components/backlinks-panel';
import { GeneratedTasksPanel } from '@/features/notes/components/generated-tasks-panel';
import { NoteCategoryPicker } from '@/features/notes/components/note-category-picker';
import { NoteEditorBody } from '@/features/notes/components/note-editor-body';
import { TagPicker } from '@/features/notes/components/tag-picker';
import {
  useNote,
  useNoteAttachments,
  useNoteBacklinks,
  useNoteGeneratedTasks,
  useNoteTagsForNote,
} from '@/features/notes/hooks/use-note';
import { useNoteMutations } from '@/features/notes/hooks/use-note-mutations';
import { useNoteTags } from '@/features/notes/hooks/use-notes';
import {
  createTag,
  createTaskFromNote,
  deleteTag,
} from '@/features/notes/services/notes-repository';
import { useKeyboardHeight } from '@/hooks/use-keyboard-height';

const AUTOSAVE_DELAY_MS = 500;

/**
 * Custom header (not the native Stack.Screen header) — SDK 54's Android
 * edge-to-edge changes made the native header's automatic status-bar inset
 * unreliable, overlapping the back button with the system clock. Manual
 * insets.top padding, same as the "new" modal screens, sidesteps it.
 */
export default function NoteDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const keyboardHeight = useKeyboardHeight();
  const {
    data: note,
    isLoading: noteLoading,
    error: noteError,
    refetch: refetchNote,
  } = useNote(id);
  const { data: noteTags = [], refetch: refetchNoteTags } = useNoteTagsForNote(id);
  const { data: allTags = [], refetch: refetchAllTags } = useNoteTags();
  const { data: attachments = [] } = useNoteAttachments(id);
  const { data: backlinks = [] } = useNoteBacklinks(id);
  const { data: generatedTasks = [] } = useNoteGeneratedTasks(id);
  const { update, remove, archive, unarchive, setTags, attach, removeAttachment } =
    useNoteMutations();
  const queryClient = useQueryClient();

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');

  useEffect(() => {
    if (note) {
      setTitle(note.title);
      setBody(note.body ?? '');
    }
  }, [note?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!note || title === note.title) return;
    const timeout = setTimeout(
      () => update.mutate({ id: note.id, input: { title } }),
      AUTOSAVE_DELAY_MS,
    );
    return () => clearTimeout(timeout);
  }, [title]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!note || body === (note.body ?? '')) return;
    const timeout = setTimeout(
      () => update.mutate({ id: note.id, input: { body } }),
      AUTOSAVE_DELAY_MS,
    );
    return () => clearTimeout(timeout);
  }, [body]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * One task per press, however fast the press.
   *
   * The write is synchronous but `router.push` is not, so the button stays
   * mounted and pressable for the length of the navigation transition. A
   * double-tap — or one impatient second tap while the screen is still on its
   * way out — ran the handler twice and left two identical tasks behind, which
   * is what a note titled once produced two of.
   *
   * A ref, not state: it has to take effect within the same tick as the first
   * press, before React has re-rendered anything. `useFocusEffect` clears it on
   * the way back, so deliberately generating a second task from the same note
   * still works — GeneratedTasksPanel lists them all, and more than one is a
   * supported outcome. Only the accidental repeat is blocked.
   *
   * Above the `!note` guard below, or these three hooks would run in a
   * different order on the render where the note has not loaded yet.
   */
  const creatingTask = useRef(false);
  useFocusEffect(
    useCallback(() => {
      creatingTask.current = false;
    }, []),
  );

  /**
   * `!note` used to `return null` — a blank screen for three different
   * situations: still loading, the read failed, and the note genuinely no longer
   * exists. All three showed nothing at all, so a failed read was
   * indistinguishable from a deleted note, and neither offered a way back
   * except the system gesture.
   *
   * The header renders in all three so `back` is always reachable; only the body
   * differs.
   */
  if (!note) {
    return (
      <View className="flex-1 bg-background">
        <Stack.Screen options={{ headerShown: false }} />
        <ScreenHeader eyebrow={t('notes.title')} tint={moduleTints.notes} />
        {noteLoading ? (
          <View className="gap-3 px-5 pt-2">
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="h-5 w-1/3" />
            <Skeleton className="h-40 w-full" />
          </View>
        ) : noteError ? (
          <QueryError error={noteError} onRetry={() => refetchNote()} />
        ) : (
          <EmptyState
            icon={FileQuestion}
            title={t('notes.notFound')}
            description={t('notes.notFoundBody')}
          />
        )}
      </View>
    );
  }

  const selectedTagIds = noteTags.map((tag) => tag.id);

  const toggleTag = (tagId: string) => {
    const next = selectedTagIds.includes(tagId)
      ? selectedTagIds.filter((id) => id !== tagId)
      : [...selectedTagIds, tagId];
    setTags.mutate({ id: note.id, tagIds: next });
    refetchNoteTags();
  };

  const handleCreateTag = (name: string) => {
    const tag = createTag(name);
    setTags.mutate({ id: note.id, tagIds: [...selectedTagIds, tag.id] });
    refetchAllTags();
    refetchNoteTags();
  };

  const handleDeleteTag = (tagId: string) => {
    deleteTag(tagId);
    refetchAllTags();
    refetchNoteTags();
  };

  const handleCreateTask = () => {
    if (creatingTask.current) return;
    creatingTask.current = true;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const task = createTaskFromNote(note.id, note.title.trim() || t('notes.untitledTaskTitle'));
    queryClient.invalidateQueries({ queryKey: ['notes', 'detail', note.id, 'generated-tasks'] });
    queryClient.invalidateQueries({ queryKey: ['tasks'] });
    router.push(`/task/${task.id}`);
  };

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen options={{ headerShown: false }} />

      <ScreenHeader
        eyebrow={t('notes.title')}
        tint={moduleTints.notes}
        right={
          <View className="flex-row gap-4">
            <Pressable
              accessibilityRole="button"
              onPress={handleCreateTask}
              hitSlop={8}
              accessibilityLabel={t('notes.createTask')}
            >
              <ListPlus size={20} color={colors[scheme].foreground} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => update.mutate({ id: note.id, input: { isPinned: !note.isPinned } })}
              hitSlop={8}
            >
              <Star
                size={20}
                color={colors[scheme].accent}
                fill={note.isPinned ? colors[scheme].accent : 'transparent'}
              />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                note.isArchived ? unarchive.mutate(note.id) : archive.mutate(note.id)
              }
              hitSlop={8}
            >
              {note.isArchived ? (
                <ArchiveRestore size={19} color={colors[scheme].foreground} />
              ) : (
                <Archive size={19} color={colors[scheme].foreground} />
              )}
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                remove.mutate(note.id);
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
        <Input
          surface="bare"
          value={title}
          onChangeText={setTitle}
          multiline
          accessibilityLabel={t('notes.noteTitle')}
          placeholder={t('notes.noteTitle')}
          style={{
            fontSize: 26,
            fontFamily: 'Sora_700Bold',
            lineHeight: 32,
            color: colors[scheme].foreground,
          }}
        />

        <View className={cardClass({ padding: 'none' }, 'px-4')}>
          <AttributeRow icon={Tag} label={t('fields.category')} isFirst>
            <NoteCategoryPicker
              value={note.categoryId}
              onChange={(categoryId) => update.mutate({ id: note.id, input: { categoryId } })}
            />
          </AttributeRow>
          <AttributeRow icon={Tags} label={t('notes.tags')}>
            <TagPicker
              tags={allTags}
              selectedTagIds={selectedTagIds}
              onToggle={toggleTag}
              onCreateTag={handleCreateTag}
              onDeleteTag={handleDeleteTag}
            />
          </AttributeRow>
          <AttributeRow icon={Bell} label={t('fields.reminder')}>
            <ReminderPicker
              value={note.reminderAt}
              onChange={(reminderAt) => update.mutate({ id: note.id, input: { reminderAt } })}
            />
          </AttributeRow>
        </View>

        <NoteEditorBody
          noteId={note.id}
          value={body}
          onChangeText={setBody}
          placeholder={t('notes.writeSomething')}
        />

        <View className="gap-2">
          <VoiceNoteRecorder
            onRecorded={(uri, durationMs) =>
              attach.mutate({ id: note.id, kind: 'audio', uri, durationMs })
            }
          />
          <AttachmentStrip
            attachments={attachments}
            onAddImage={(uri) => attach.mutate({ id: note.id, kind: 'image', uri })}
            onAddFile={(uri, kind) => attach.mutate({ id: note.id, kind, uri })}
            onRemove={(attachmentId) =>
              removeAttachment.mutate({ id: attachmentId, noteId: note.id })
            }
          />
        </View>

        <GeneratedTasksPanel tasks={generatedTasks} />
        <BacklinksPanel backlinks={backlinks} />
      </ScrollView>
    </View>
  );
}
