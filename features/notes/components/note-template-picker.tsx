import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';

import { Text } from '@/components/ui/text';
import { colors } from '@/constants/theme';
import { NOTE_TEMPLATES } from '@/features/notes/config/note-templates';
import { cn } from '@/lib/utils';

type Props = {
  selectedId: string | null;
  onSelect: (templateId: string | null) => void;
};

/** A quick-start row on the new-note screen. Picking a template replaces the
 *  body with its starter content; picking it again (or nothing) clears back
 *  to blank — cheap to undo since this only ever applies to a fresh note. */
export function NoteTemplatePicker({ selectedId, onSelect }: Props) {
  const { t } = useTranslation();
  const scheme = useColorScheme() ?? 'light';

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerClassName="items-center gap-2"
    >
      {NOTE_TEMPLATES.map((template) => {
        const isSelected = selectedId === template.id;
        return (
          <Pressable
            key={template.id}
            accessibilityRole="button"
            accessibilityState={{ selected: isSelected }}
            onPress={() => {
              Haptics.selectionAsync();
              onSelect(isSelected ? null : template.id);
            }}
            className={cn(
              'flex-row items-center gap-1.5 rounded-full border px-3 py-1.5',
              isSelected ? 'border-accent bg-accent' : 'border-border',
            )}
          >
            <template.icon
              size={14}
              color={isSelected ? colors[scheme].accentForeground : colors[scheme].mutedForeground}
            />
            <View>
              <Text
                className={
                  isSelected ? 'font-sora-medium text-accent-foreground' : 'text-muted-foreground'
                }
              >
                {t(template.titleKey)}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
