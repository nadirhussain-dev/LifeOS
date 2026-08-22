import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';

import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { SheetHeader } from '@/components/ui/sheet-header';
import { Text } from '@/components/ui/text';
import { colors } from '@/constants/theme';
import { useRoutineMutations } from '@/features/habits/hooks/use-routine-mutations';
import { useUnsavedChanges } from '@/hooks/use-unsaved-changes';

export default function NewRoutineScreen() {
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const { create } = useRoutineMutations();
  const [name, setName] = useState('');
  const release = useUnsavedChanges(name.trim() !== '');

  const handleCreate = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    release();
    create.mutate(trimmed, {
      onSuccess: (routine) => router.replace(`/routine/${routine.id}`),
    });
  };

  return (
    <View className="flex-1 bg-background">
      <SheetHeader title={t('habits.newRoutine')} />

      <View className="gap-6 px-5 pt-3">
        <Input
          surface="bare"
          value={name}
          onChangeText={setName}
          accessibilityLabel={t('habits.routineName')}
          placeholder={t('habits.routineNamePlaceholder')}
          autoFocus
          onSubmitEditing={handleCreate}
          style={{ fontSize: 24, fontFamily: 'Sora_700Bold', color: colors[scheme].foreground }}
        />
        <Text variant="muted">{t('habits.routineNextHint')}</Text>
        <Button
          label={t('habits.createRoutine')}
          onPress={handleCreate}
          disabled={!name.trim()}
          size="lg"
          variant="accent"
        />
      </View>
    </View>
  );
}
