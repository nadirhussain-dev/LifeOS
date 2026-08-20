import * as Haptics from 'expo-haptics';
import { Plus } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';

import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { categoryColorPalette, colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { StudySubject } from '@/features/study/types/study.types';
import { cn } from '@/lib/utils';

type Props = {
  subjects: StudySubject[];
  value: string | null;
  onChange: (subjectId: string | null) => void;
  onCreate: (name: string, colorToken: string) => void;
};

/** Chip-row picker for the session's subject, with inline creation. New
 * subjects cycle through the shared category palette so colors stay on-brand. */
export function SubjectPicker({ subjects, value, onChange, onCreate }: Props) {
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const [isAdding, setIsAdding] = useState(false);
  const [name, setName] = useState('');

  const select = (id: string | null) => {
    Haptics.selectionAsync();
    onChange(id);
  };

  const confirm = () => {
    const trimmed = name.trim();
    if (trimmed) {
      const color = categoryColorPalette[subjects.length % categoryColorPalette.length];
      onCreate(trimmed, color);
    }
    setName('');
    setIsAdding(false);
  };

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
          {t('study.general')}
        </Text>
      </Pressable>

      {subjects.map((subject) => {
        const selected = subject.id === value;
        return (
          <Pressable
            accessibilityRole="button"
            key={subject.id}
            onPress={() => select(subject.id)}
            style={
              selected
                ? { backgroundColor: subject.colorToken, borderColor: subject.colorToken }
                : undefined
            }
            className={cn(
              'flex-row items-center gap-1.5 rounded-full border px-3 py-1.5',
              !selected && 'border-border',
            )}
          >
            {!selected && (
              <View
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: subject.colorToken }}
              />
            )}
            <Text className={selected ? 'font-sora-medium text-white' : 'text-muted-foreground'}>
              {subject.name}
            </Text>
          </Pressable>
        );
      })}

      {isAdding ? (
        <View className="rounded-full border border-border px-2 py-1">
          <Input
            surface="bare"
            value={name}
            onChangeText={setName}
            accessibilityLabel={t('study.subjectName')}
            placeholder={t('study.subjectPlaceholder')}
            autoFocus
            onSubmitEditing={confirm}
            onBlur={confirm}
            className="min-w-24 px-1 text-foreground"
          />
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          onPress={() => setIsAdding(true)}
          className="flex-row items-center gap-1 rounded-full border border-dashed border-border px-3 py-1.5"
        >
          <Plus size={14} color={colors[scheme].mutedForeground} />
          <Text variant="muted">{t('study.new')}</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}
