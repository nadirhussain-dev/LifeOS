import { Eye, Pencil } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, TextInput, View } from 'react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';

import { cardClass } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { colors } from '@/constants/theme';
import { MarkdownToolbar } from '@/features/notes/components/markdown-toolbar';
import { NoteBodyView } from '@/features/notes/components/note-body-view';
import { toggleChecklistAt } from '@/features/notes/services/markdown';

type Selection = { start: number; end: number };

type Props = {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
};

/** Markdown-as-plain-text editor: a docked formatting toolbar over a plain
 * TextInput, plus a render/edit toggle — deliberately not a WYSIWYG
 * contenteditable surface, which is where RN rich-text libraries get
 * unreliable on the new architecture. */
export function NoteEditorBody({ value, onChangeText, placeholder }: Props) {
  const { t } = useTranslation();
  const scheme = useColorScheme() ?? 'light';
  const [mode, setMode] = useState<'edit' | 'read'>('edit');
  const [selection, setSelection] = useState<Selection>({ start: 0, end: 0 });

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
          <TextInput
            value={value}
            onChangeText={onChangeText}
            onSelectionChange={(event) => setSelection(event.nativeEvent.selection)}
            multiline
            accessibilityLabel={t('notes.noteBody')}
            placeholder={placeholder}
            placeholderTextColor={colors[scheme].mutedForeground}
            className="min-h-32 p-4 text-base text-foreground"
            textAlignVertical="top"
          />
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
