import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Briefcase, Home, Plane, Shapes, Users, type LucideIcon } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';

import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { InlineError } from '@/components/ui/query-error';
import { SheetHeader } from '@/components/ui/sheet-header';
import { Text } from '@/components/ui/text';
import { moduleTint } from '@/constants/design-tokens';
import { colors } from '@/constants/theme';
import { useBudgetSettings } from '@/features/budget/hooks/use-budget';
import { useSplitMutations } from '@/features/split/hooks/use-split';
import type { GroupKind } from '@/features/split/types/split.types';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useUnsavedChanges } from '@/hooks/use-unsaved-changes';
import { alpha } from '@/lib/color';
import { toast } from '@/lib/toast-store';

/** Each kind gets an icon so the row reads at a glance rather than as five
 *  interchangeable words. */
const KINDS: { value: GroupKind; icon: LucideIcon }[] = [
  { value: 'trip', icon: Plane },
  { value: 'home', icon: Home },
  { value: 'family', icon: Users },
  { value: 'work', icon: Briefcase },
  { value: 'other', icon: Shapes },
];

export default function NewSplitGroupScreen() {
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const tint = moduleTint('budget', scheme);
  // Groups settle in one currency; default to the one Budget already uses.
  const { data: budgetSettings } = useBudgetSettings();
  const currency = budgetSettings?.currency ?? '$';
  const { createGroup } = useSplitMutations();

  const [name, setName] = useState('');
  const [kind, setKind] = useState<GroupKind>('trip');

  const canSave = name.trim().length > 0 && !createGroup.isPending;
  const release = useUnsavedChanges(name.trim() !== '' || kind !== 'trip');

  const save = () => {
    if (!canSave) return;
    release();
    createGroup.mutate(
      { name: name.trim(), kind, currency },
      {
        // The success haptic used to fire here, on tap, before the request had
        // been made — so a failed save still felt like a successful one.
        onSuccess: (groupId) => {
          toast.success(t('split.groupCreated', { name: name.trim() }));
          router.replace(`/split/${groupId}`);
        },
        onError: () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
      },
    );
  };

  return (
    <View className="flex-1 bg-background">
      <SheetHeader title={t('split.newGroup')} />

      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerClassName="gap-6 px-5 pt-3 pb-10"
          keyboardShouldPersistTaps="handled"
        >
          <Input
            surface="bare"
            value={name}
            onChangeText={setName}
            accessibilityLabel={t('split.groupName')}
            placeholder={t('split.groupNamePlaceholder')}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={save}
            maxLength={60}
            style={{ fontSize: 24, fontFamily: 'Sora_700Bold', color: colors[scheme].foreground }}
          />

          <View className="gap-2.5">
            <Text variant="caption" className="font-sora-semibold uppercase tracking-wide">
              {t('split.groupKind')}
            </Text>
            <View className="flex-row flex-wrap gap-2">
              {KINDS.map(({ value, icon: Icon }) => {
                const selected = value === kind;
                return (
                  <Pressable
                    key={value}
                    onPress={() => {
                      void Haptics.selectionAsync();
                      setKind(value);
                    }}
                    accessibilityRole="radio"
                    accessibilityState={{ selected, checked: selected }}
                    accessibilityLabel={t(`split.kind.${value}`)}
                    style={{
                      minHeight: 44,
                      borderColor: selected ? tint : colors[scheme].border,
                      backgroundColor: selected ? alpha(tint, 0.14) : 'transparent',
                    }}
                    className="flex-row items-center gap-2 rounded-full border px-3.5 py-2"
                  >
                    <Icon
                      size={16}
                      color={selected ? tint : colors[scheme].mutedForeground}
                      strokeWidth={selected ? 2.4 : 2}
                    />
                    <Text
                      className="font-sora-medium"
                      style={{ color: selected ? tint : colors[scheme].mutedForeground }}
                    >
                      {t(`split.kind.${value}`)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <Text variant="caption">{t('split.currencyNote', { currency })}</Text>

          {/* The real reason, not "check your connection" — see
              lib/supabase-error.ts and migration 0007. */}
          {createGroup.isError ? <InlineError error={createGroup.error} /> : null}

          <Button
            label={createGroup.isPending ? t('common.saving') : t('split.createGroup')}
            onPress={save}
            disabled={!canSave}
            size="lg"
            variant="accent"
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
