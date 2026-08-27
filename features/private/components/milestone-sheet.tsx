import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetTextInput,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import { format } from 'date-fns/format';
import { parseISO } from 'date-fns/parseISO';
import { forwardRef, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Switch, View } from 'react-native';

import { Repeat, Trash2 } from '@/components/ui/icons';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { colors } from '@/constants/theme';
import { AlbumDateField } from '@/features/private/components/album-date-field';
import type { DecryptedMilestone } from '@/features/private/hooks/use-album-milestones';
import { useColorScheme } from '@/hooks/use-color-scheme';

type Mutations = {
  addMilestone: {
    mutate: (input: {
      title: string;
      milestoneDate: string;
      recurring: boolean;
      albumKey: Uint8Array;
    }) => void;
  };
  removeMilestone: { mutate: (milestoneId: string) => void };
};

type Props = {
  milestones: DecryptedMilestone[];
  tint: string;
  albumKey: Uint8Array | null;
  mutations: Mutations;
};

/**
 * Custom milestones — deliberately the smallest UI in this feature set (see
 * together.ts's header): a short list plus a compact add row, no dedicated
 * route, no edit (only add/remove — a wrong date is cheaper to delete and
 * re-add than to build a second form for). Opened from a small icon on
 * TogetherStrip rather than a fourth header button on [id].tsx.
 */
export const MilestoneSheet = forwardRef<BottomSheetModal, Props>(function MilestoneSheet(
  { milestones, tint, albumKey, mutations },
  ref,
) {
  const scheme = useColorScheme() ?? 'light';
  const theme = colors[scheme];
  const { t } = useTranslation();

  const [title, setTitle] = useState('');
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [recurring, setRecurring] = useState(true);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} opacity={0.4} />
    ),
    [],
  );

  const add = () => {
    if (!title.trim() || !albumKey) return;
    mutations.addMilestone.mutate({
      title: title.trim(),
      milestoneDate: date,
      recurring,
      albumKey,
    });
    setTitle('');
  };

  return (
    <BottomSheetModal
      ref={ref}
      enableDynamicSizing
      backdropComponent={renderBackdrop}
      backgroundStyle={{ backgroundColor: theme.card }}
      handleIndicatorStyle={{ backgroundColor: theme.border }}
    >
      <BottomSheetScrollView contentContainerClassName="gap-3 px-5 pb-8 pt-2">
        <Text variant="subheading">{t('private.milestones')}</Text>

        {milestones.length === 0 ? (
          <Text variant="caption" className="py-2 text-center">
            {t('private.noMilestonesYet')}
          </Text>
        ) : (
          milestones.map((m) => (
            <View key={m.id} className="flex-row items-center gap-2.5">
              <View className="flex-1 gap-0.5">
                <Text className="font-sora-medium text-foreground" numberOfLines={1}>
                  {m.title ?? t('private.commentLocked')}
                </Text>
                <View className="flex-row items-center gap-1.5">
                  <Text variant="caption">{format(parseISO(m.milestoneDate), 'd MMM yyyy')}</Text>
                  {m.recurring ? <Repeat size={11} color={theme.mutedForeground} /> : null}
                </View>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('common.delete')}
                hitSlop={8}
                onPress={() => mutations.removeMilestone.mutate(m.id)}
              >
                <Trash2 size={14} color={theme.mutedForeground} />
              </Pressable>
            </View>
          ))
        )}

        <View className="mt-2 gap-2.5 border-t border-border pt-3">
          <View className="flex-row items-center justify-between">
            <Text variant="micro">{t('private.newMilestone')}</Text>
            <AlbumDateField value={date} onChange={setDate} />
          </View>
          <Input
            surface="bare"
            as={BottomSheetTextInput}
            value={title}
            onChangeText={setTitle}
            placeholder={t('private.milestoneTitlePlaceholder')}
            style={{
              color: theme.foreground,
              borderWidth: 1,
              borderColor: theme.border,
              borderRadius: 14,
              paddingHorizontal: 14,
              paddingVertical: 10,
            }}
          />
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-1.5">
              <Repeat size={13} color={theme.mutedForeground} />
              <Text variant="caption">{t('private.recurringYearly')}</Text>
            </View>
            <Switch
              value={recurring}
              onValueChange={setRecurring}
              trackColor={{ true: tint, false: theme.border }}
            />
          </View>
          <Button
            variant="accent"
            label={t('private.addMilestone')}
            disabled={!title.trim()}
            onPress={add}
            style={{ backgroundColor: tint }}
          />
        </View>
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
});
