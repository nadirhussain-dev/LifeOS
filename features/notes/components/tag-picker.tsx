import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';
import { Plus } from '@/components/ui/icons';
import { useColorScheme } from '@/hooks/use-color-scheme';

import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { colors } from '@/constants/theme';
import type { NoteTag } from '@/features/notes/types/note.types';
import { cn } from '@/lib/utils';
import { confirm } from '@/lib/dialog-store';

type Props = {
  tags: NoteTag[];
  selectedTagIds: string[];
  onToggle: (tagId: string) => void;
  onCreateTag: (name: string) => void;
  onDeleteTag: (tagId: string) => void;
};

/** Multi-select chip picker for tags — distinct from the single-select CategoryPicker,
 * since a note can carry any number of tags alongside its one category. */
export function TagPicker({ tags, selectedTagIds, onToggle, onCreateTag, onDeleteTag }: Props) {
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const [isAdding, setIsAdding] = useState(false);
  const [name, setName] = useState('');
  const selected = new Set(selectedTagIds);

  const confirmNewTag = () => {
    const trimmed = name.trim();
    if (trimmed) onCreateTag(trimmed);
    setName('');
    setIsAdding(false);
  };

  const confirmDelete = (tag: NoteTag) => {
    void confirm({
      title: t('notes.deleteTagTitle'),
      message: t('notes.deleteTagBody', { name: tag.name }),
      confirmLabel: t('common.delete'),
      cancelLabel: t('common.cancel'),
      destructive: true,
    }).then(async (ok) => {
      if (!ok) return;
      onDeleteTag(tag.id);
    });
  };

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerClassName="items-center gap-2"
    >
      {tags.map((tag) => {
        const isSelected = selected.has(tag.id);
        return (
          <Pressable
            accessibilityRole="button"
            key={tag.id}
            onPress={() => {
              Haptics.selectionAsync();
              onToggle(tag.id);
            }}
            onLongPress={() => confirmDelete(tag)}
            className={cn(
              'rounded-full border px-3 py-1.5',
              isSelected ? 'border-accent bg-accent' : 'border-border',
            )}
          >
            <Text
              className={
                isSelected ? 'font-sora-medium text-accent-foreground' : 'text-muted-foreground'
              }
            >
              #{tag.name}
            </Text>
          </Pressable>
        );
      })}

      {isAdding ? (
        <View className="flex-row items-center gap-1.5 rounded-full border border-border px-2 py-1">
          <Input
            surface="bare"
            value={name}
            onChangeText={setName}
            accessibilityLabel={t('notes.tagName')}
            placeholder={t('notes.tagName')}
            autoFocus
            onSubmitEditing={confirmNewTag}
            onBlur={confirmNewTag}
            className="min-w-20 px-1 text-foreground"
          />
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          onPress={() => setIsAdding(true)}
          className="flex-row items-center gap-1 rounded-full border border-dashed border-border px-3 py-1.5"
        >
          <Plus size={14} color={colors[scheme].mutedForeground} />
          <Text variant="muted">{t('notes.addTag')}</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}
