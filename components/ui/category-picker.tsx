import * as Haptics from 'expo-haptics';
import { Plus } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';

import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { colors } from '@/constants/theme';
import { cn } from '@/lib/utils';
import { confirm } from '@/lib/dialog-store';

export type CategoryOption = {
  id: string;
  name: string;
  colorToken: string;
  deletedAt?: number | null;
};

type Props = {
  value: string | null;
  categories: CategoryOption[];
  /** The category currently assigned (`value`) resolved even if it's been soft-deleted and no longer in `categories`. */
  selectedCategory?: CategoryOption | null;
  onChange: (categoryId: string | null) => void;
  onCreateCategory: (name: string) => void;
  onDeleteCategory: (categoryId: string) => void;
};

/**
 * Generic chip-row category picker shared by tasks and notes. Extracted
 * because both features need identical select/create/delete behavior —
 * only the backing repository differs, which callers wire in via props.
 */
export function CategoryPicker({
  value,
  categories,
  selectedCategory,
  onChange,
  onCreateCategory,
  onDeleteCategory,
}: Props) {
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const [isAdding, setIsAdding] = useState(false);
  const [name, setName] = useState('');

  const select = (categoryId: string | null) => {
    Haptics.selectionAsync();
    onChange(categoryId);
  };

  const confirmNewCategory = () => {
    const trimmed = name.trim();
    if (trimmed) onCreateCategory(trimmed);
    setName('');
    setIsAdding(false);
  };

  const confirmDelete = (category: CategoryOption) => {
    void confirm({
      title: t('category.deleteTitle'),
      message: t('category.deleteBody', { name: category.name }),
      confirmLabel: t('common.delete'),
      cancelLabel: t('common.cancel'),
      destructive: true,
    }).then(async (ok) => {
      if (!ok) return;
      onDeleteCategory(category.id);
    });
  };

  // The assigned category may have been soft-deleted elsewhere and dropped
  // from the active list — still render it (dimmed, no delete affordance)
  // so this task/note doesn't appear to silently lose its label.
  const isOrphanedSelection =
    !!selectedCategory && !categories.some((category) => category.id === selectedCategory.id);
  const displayedCategories = isOrphanedSelection ? [...categories, selectedCategory!] : categories;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerClassName="items-center gap-2"
    >
      <Pressable
        accessibilityRole="button"
        onPress={() => select(null)}
        className={cn(
          'rounded-full border px-3 py-1.5',
          value === null ? 'border-foreground bg-foreground' : 'border-border',
        )}
      >
        <Text className={value === null ? 'text-background' : 'text-muted-foreground'}>
          {t('fields.none')}
        </Text>
      </Pressable>

      {displayedCategories.map((category) => {
        const selected = category.id === value;
        const isDeleted = !!category.deletedAt;
        return (
          <Pressable
            accessibilityRole="button"
            key={category.id}
            onPress={() => select(category.id)}
            onLongPress={() => !isDeleted && confirmDelete(category)}
            style={[
              selected
                ? { backgroundColor: category.colorToken, borderColor: category.colorToken }
                : undefined,
              isDeleted ? { opacity: 0.5 } : undefined,
            ]}
            className={cn(
              'flex-row items-center gap-1.5 rounded-full border px-3 py-1.5',
              !selected && 'border-border',
            )}
          >
            {!selected && (
              <View
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: category.colorToken }}
              />
            )}
            <Text className={selected ? 'font-sora-medium text-white' : 'text-muted-foreground'}>
              {category.name}
            </Text>
          </Pressable>
        );
      })}

      {isAdding ? (
        <View className="flex-row items-center gap-1.5 rounded-full border border-border px-2 py-1">
          {/*
            The last raw `TextInput` in the app, and it was raw for a reason
            that stopped applying: the surface here is a pill the parent draws,
            so none of `Input`'s chrome was wanted. `surface="bare"` with no
            label, error or affix is exactly that — it returns the bare element
            and adds only the things every field should have had anyway, which
            now includes suppressing Android's own emerald-tinted underline.
            Inside a rounded pill that underline was a green line across the
            bottom of the field.
          */}
          <Input
            surface="bare"
            value={name}
            onChangeText={setName}
            accessibilityLabel={t('category.name')}
            placeholder={t('category.name')}
            autoFocus
            onSubmitEditing={confirmNewCategory}
            onBlur={confirmNewCategory}
            className="min-w-24 px-1"
          />
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          onPress={() => setIsAdding(true)}
          className="flex-row items-center gap-1 rounded-full border border-dashed border-border px-3 py-1.5"
        >
          <Plus size={14} color={colors[scheme].mutedForeground} />
          <Text variant="muted">{t('category.new')}</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}
