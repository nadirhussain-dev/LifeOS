import { useQuery } from '@tanstack/react-query';
import { Eye, Pencil } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';

import { Input } from '@/components/ui/input';
import { cardClass } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { colors } from '@/constants/theme';
import { MarkdownToolbar } from '@/features/notes/components/markdown-toolbar';
import { NoteBodyView } from '@/features/notes/components/note-body-view';
import { WikiLinkAutocomplete } from '@/features/notes/components/wiki-link-autocomplete';
import { useNoteMutations } from '@/features/notes/hooks/use-note-mutations';
import { findOpenWikiLink, toggleChecklistAt } from '@/features/notes/services/markdown';
import { listNotes } from '@/features/notes/services/notes-repository';

type Selection = { start: number; end: number };

type Props = {
  noteId: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
};

const AUTOCOMPLETE_LIMIT = 6;

/** Markdown-as-plain-text editor: a docked formatting toolbar over a plain
 * TextInput, plus a render/edit toggle — deliberately not a WYSIWYG
 * contenteditable surface, which is where RN rich-text libraries get
 * unreliable on the new architecture.
 *
 * Also owns the `[[wiki-link]]` autocomplete: the link storage/backlink
 * machinery already existed (`syncNoteLinks`), but typing `[[` was unassisted
 * plain text that silently no-op'd on a typo or a note that doesn't exist —
 * this is what makes the feature discoverable and makes a link that can't
 * find its target an explicit "create it" choice instead of a silent no-op. */
export function NoteEditorBody({ noteId, value, onChangeText, placeholder }: Props) {
  const { t } = useTranslation();
  const scheme = useColorScheme() ?? 'light';
  const [mode, setMode] = useState<'edit' | 'read'>('edit');
  const [selection, setSelection] = useState<Selection>({ start: 0, end: 0 });
  const { create } = useNoteMutations();

  // Same cache key as `useNotes()`, deliberately without its search-box
  // `select` filter — an unrelated search someone typed on the notes list
  // has no business narrowing which notes autocomplete can find.
  const { data: allNotes = [] } = useQuery({
    queryKey: ['notes'],
    queryFn: async () => listNotes(),
  });

  const openLink = mode === 'edit' ? findOpenWikiLink(value, selection.start) : null;
  const linkMatches = useMemo(() => {
    if (!openLink) return [];
    const q = openLink.query.trim().toLowerCase();
    const candidates = allNotes.filter((note) => note.id !== noteId);
    const filtered = q
      ? candidates.filter((note) => note.title.toLowerCase().includes(q))
      : candidates;
    return [...filtered].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, AUTOCOMPLETE_LIMIT);
  }, [openLink, allNotes, noteId]);

  function insertLink(title: string) {
    if (!openLink) return;
    const before = value.slice(0, openLink.start);
    const after = value.slice(selection.start);
    const inserted = `[[${title}]]`;
    onChangeText(before + inserted + after);
    const cursor = before.length + inserted.length;
    setSelection({ start: cursor, end: cursor });
  }

  async function createAndLink(title: string) {
    const note = await create.mutateAsync({ title });
    insertLink(note.title);
  }

  return (
    <View className="gap-2">
      <View className="flex-row items-center justify-between">
        <Text variant="caption" className="font-sora-semibold uppercase tracking-wide">
          Note
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => setMode((current) => (current === 'edit' ? 'read' : 'edit'))}
          className="flex-row items-center gap-1.5 rounded-full border border-border px-2.5 py-1"
        >
          {mode === 'edit' ? (
            <Eye size={13} color={colors[scheme].mutedForeground} />
          ) : (
            <Pencil size={13} color={colors[scheme].mutedForeground} />
          )}
          <Text variant="caption">{mode === 'edit' ? 'Preview' : 'Edit'}</Text>
        </Pressable>
      </View>

      {mode === 'edit' ? (
        <View className={cardClass({ padding: 'none' }, 'overflow-hidden')}>
          <Input
            surface="bare"
            value={value}
            onChangeText={onChangeText}
            onSelectionChange={(event) => setSelection(event.nativeEvent.selection)}
            multiline
            accessibilityLabel={t('notes.noteBody')}
            placeholder={placeholder}
            className="min-h-32 p-4 text-base text-foreground"
            textAlignVertical="top"
          />
          {openLink && (linkMatches.length > 0 || openLink.query.trim().length > 0) && (
            <WikiLinkAutocomplete
              query={openLink.query}
              matches={linkMatches}
              onSelect={insertLink}
              onCreate={createAndLink}
            />
          )}
          <MarkdownToolbar
            value={value}
            selection={selection}
            onChange={(nextValue, nextSelection) => {
              onChangeText(nextValue);
              setSelection(nextSelection);
            }}
          />
        </View>
      ) : (
        <View className={cardClass({ padding: 'md' })}>
          <NoteBodyView
            body={value}
            onToggleChecklist={(index) => onChangeText(toggleChecklistAt(value, index))}
          />
        </View>
      )}
    </View>
  );
}
