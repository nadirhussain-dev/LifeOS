import { Plus } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { colors } from '@/constants/theme';
import type { Note } from '@/features/notes/types/note.types';
import { useColorScheme } from '@/hooks/use-color-scheme';

type Props = {
  query: string;
  matches: Note[];
  onSelect: (title: string) => void;
  onCreate: (title: string) => void;
};

/**
 * The suggestion panel shown while typing inside an open `[[...`. Sits
 * beneath the editor rather than floating at the cursor — measuring cursor
 * position in a multiline RN TextInput to place a floating popover is the
 * fragile part of most autocomplete implementations, and a docked panel gets
 * the same job done without it.
 *
 * Always offers "Create note" for a non-matching title, because the wiki-link
 * system silently no-ops on an unmatched title otherwise — the one thing this
 * whole feature exists to fix.
 */
export function WikiLinkAutocomplete({ query, matches, onSelect, onCreate }: Props) {
  const { t } = useTranslation();
  const scheme = useColorScheme() ?? 'light';
  const trimmed = query.trim();
  const hasExactMatch = matches.some((note) => note.title.toLowerCase() === trimmed.toLowerCase());

  return (
    <View className="border-t border-border bg-card">
      {matches.map((note) => (
        <Pressable
          key={note.id}
          accessibilityRole="button"
          onPress={() => onSelect(note.title)}
          className="border-b border-border px-4 py-2.5 active:bg-muted"
        >
          <Text numberOfLines={1}>{note.title}</Text>
        </Pressable>
      ))}
      {trimmed.length > 0 && !hasExactMatch && (
        <Pressable
          accessibilityRole="button"
          onPress={() => onCreate(trimmed)}
          className="flex-row items-center gap-2 px-4 py-2.5 active:bg-muted"
        >
          <Plus size={15} color={colors[scheme].accent} />
          <Text style={{ color: colors[scheme].accent }} numberOfLines={1}>
            {t('notes.createLinkedNote', { title: trimmed })}
          </Text>
        </Pressable>
      )}
    </View>
  );
}
