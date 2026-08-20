import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import * as Haptics from 'expo-haptics';
import { Minus, Plus } from 'lucide-react-native';
import { forwardRef, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';

import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { colors } from '@/constants/theme';
import type { HabitWithToday } from '@/features/habits/types/habit.types';

type Props = {
  habit: HabitWithToday | null;
  onSubmit: (value: number) => void;
};

export const QuickLogSheet = forwardRef<BottomSheetModal, Props>(function QuickLogSheet(
  { habit, onSubmit },
  ref,
) {
  const scheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const [value, setValue] = useState(1);

  useEffect(() => {
    setValue(habit?.todayValue ?? habit?.targetValue ?? 1);
  }, [habit?.id, habit?.todayValue, habit?.targetValue]);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} opacity={0.4} />
    ),
    [],
  );

  const step = habit?.type === 'duration' || habit?.type === 'distance' ? 0.5 : 1;

  const adjust = (delta: number) => {
    Haptics.selectionAsync();
    setValue((prev) => Math.max(0, Math.round((prev + delta) * 100) / 100));
  };

  const confirm = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onSubmit(value);
    if (ref && 'current' in ref) ref.current?.dismiss();
  };

  return (
    <BottomSheetModal
      ref={ref}
      enableDynamicSizing
      backdropComponent={renderBackdrop}
      backgroundStyle={{ backgroundColor: colors[scheme].card }}
      handleIndicatorStyle={{ backgroundColor: colors[scheme].border }}
    >
      <BottomSheetView className="gap-4 px-5 pb-10 pt-2">
        <Text variant="subheading">{habit?.name}</Text>

        <View className="flex-row items-center justify-center gap-4">
          <Pressable
            accessibilityRole="button"
            onPress={() => adjust(-step)}
            className="h-11 w-11 items-center justify-center rounded-full border border-border"
          >
            <Minus size={18} color={colors[scheme].foreground} />
          </Pressable>

          <View className="min-w-20 flex-row items-baseline justify-center gap-1.5">
            <Input
              surface="bare"
              value={String(value)}
              onChangeText={(text) => {
                const parsed = parseFloat(text);
                setValue(Number.isFinite(parsed) ? parsed : 0);
              }}
              accessibilityLabel={t('habits.amount')}
              keyboardType="decimal-pad"
              className="min-w-10 text-center font-sora-extrabold text-2xl text-foreground"
              style={{ fontVariant: ['tabular-nums'] }}
            />
            {habit?.unit && <Text variant="muted">{habit.unit}</Text>}
          </View>

          <Pressable
            accessibilityRole="button"
            onPress={() => adjust(step)}
            className="h-11 w-11 items-center justify-center rounded-full border border-border"
          >
            <Plus size={18} color={colors[scheme].foreground} />
          </Pressable>
        </View>

        <Button label={t('habits.log')} variant="accent" onPress={confirm} />
      </BottomSheetView>
    </BottomSheetModal>
  );
});
