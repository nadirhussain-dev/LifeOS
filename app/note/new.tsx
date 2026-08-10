import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { Bell, Star, Tag } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { cardClass } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { SheetHeader } from '@/components/ui/sheet-header';
import { colors } from '@/constants/theme';
import { AttributeRow } from '@/components/ui/attribute-row';
import { ReminderPicker } from '@/components/ui/reminder-picker';
import { NoteCategoryPicker } from '@/features/notes/components/note-category-picker';
import { useNoteMutations } from '@/features/notes/hooks/use-note-mutations';
import { useKeyboardHeight } from '@/hooks/use-keyboard-height';

export default function NewNoteScreen() {
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const keyboardHeight = useKeyboardHeight();
  const { create } = useNoteMutations();

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [isPinned, setIsPinned] = useState(false);
  const [reminderAt, setReminderAt] = useState<number | null>(null);

  const focusProgress = useSharedValue(0);
  const underlineStyle = useAnimatedStyle(() => ({
    opacity: focusProgress.value,
    transform: [{ scaleX: 0.3 + focusProgress.value * 0.7 }],
  }));

  const handleAdd = () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    create.mutate({ title: trimmed, body: body.trim() || null, categoryId, isPinned, reminderAt });
    router.back();
  };

  return (
    <View className="flex-1 bg-background">
      <SheetHeader
        title={t('notes.newNote')}
        right={
          <Pressable
            accessibilityRole="button"
            onPress={() => setIsPinned((pinned) => !pinned)}
            hitSlop={10}
            className="h-9 w-9 items-center justify-center"
          >
            <Star
              size={18}
              color={colors[scheme].accent}
              fill={isPinned ? colors[scheme].accent : 'transparent'}
            />
          </Pressable>
        }
      />

      <ScrollView
        contentContainerClassName="gap-6 px-5 pt-3"
        contentContainerStyle={{ paddingBottom: keyboardHeight > 0 ? keyboardHeight + 24 : 32 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View className="gap-2">
          <TextInput
            value={title}
            onChangeText={setTitle}
            accessibilityLabel={t('notes.noteTitle')}
            placeholder={t('notes.noteTitle')}
            placeholderTextColor={colors[scheme].mutedForeground}
            autoFocus
            multiline
            onFocus={() => {
              focusProgress.value = withTiming(1, { duration: 220 });
            }}
            onBlur={() => {
              focusProgress.value = withTiming(0, { duration: 220 });
            }}
            style={{
              fontSize: 26,
              fontFamily: 'Sora_700Bold',
              lineHeight: 32,
              color: colors[scheme].foreground,
            }}
          />
          <Animated.View className="h-[3px] w-16 rounded-full bg-accent" style={underlineStyle} />
        </View>

        <View className={cardClass({ padding: 'none' }, 'px-4')}>
          <AttributeRow icon={Tag} label={t('fields.category')} isFirst>
            <NoteCategoryPicker value={categoryId} onChange={setCategoryId} />
          </AttributeRow>
          <AttributeRow icon={Bell} label={t('fields.reminder')}>
            <ReminderPicker value={reminderAt} onChange={setReminderAt} />
          </AttributeRow>
        </View>

        <TextInput
          value={body}
          onChangeText={setBody}
          multiline
          accessibilityLabel={t('notes.noteBody')}
          placeholder={t('notes.writeSomething')}
          placeholderTextColor={colors[scheme].mutedForeground}
          className={cardClass({ padding: 'md' }, 'min-h-32 text-base text-foreground')}
          textAlignVertical="top"
        />

        <Button
          label={t('notes.addNote')}
          onPress={handleAdd}
          disabled={!title.trim()}
          size="lg"
          variant="accent"
        />
      </ScrollView>
    </View>
  );
}
