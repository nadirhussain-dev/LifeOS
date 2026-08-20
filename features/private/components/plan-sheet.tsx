import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetTextInput,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import { format } from 'date-fns';
import { Trash2 } from 'lucide-react-native';
import { forwardRef, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { colors } from '@/constants/theme';
import { AlbumDateField } from '@/features/private/components/album-date-field';
import { useColorScheme } from '@/hooks/use-color-scheme';

export type PlanSheetTarget = {
  /** Null when creating. */
  id: string | null;
  title: string;
  notes: string;
  eventDate: string;
};

type Mutations = {
  addEvent: {
    mutate: (
      input: { title: string; notes: string; eventDate: string; albumKey: Uint8Array },
      opts?: { onSuccess?: () => void },
    ) => void;
  };
  updateEvent: {
    mutate: (
      input: {
        eventId: string;
        title: string;
        notes: string;
        eventDate: string;
        albumKey: Uint8Array;
      },
      opts?: { onSuccess?: () => void },
    ) => void;
  };
  removeEvent: { mutate: (eventId: string) => void };
};

type Props = {
  target: PlanSheetTarget | null;
  tint: string;
  albumKey: Uint8Array | null;
  mutations: Mutations;
};

/** Create/edit a Shared Plan — same forwardRef<BottomSheetModal> shape as
 * album-comment-sheet.tsx. */
export const PlanSheet = forwardRef<BottomSheetModal, Props>(function PlanSheet(
  { target, tint, albumKey, mutations },
  ref,
) {
  const scheme = useColorScheme() ?? 'light';
  const theme = colors[scheme];
  const { t } = useTranslation();

  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [eventDate, setEventDate] = useState(format(new Date(), 'yyyy-MM-dd'));

  useEffect(() => {
    if (!target) return;
    setTitle(target.title);
    setNotes(target.notes);
    setEventDate(target.eventDate);
  }, [target]);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} opacity={0.4} />
    ),
    [],
  );

  const dismiss = () => {
    if (ref && 'current' in ref) ref.current?.dismiss();
  };

  const save = () => {
    if (!title.trim() || !albumKey) return;
    const onSuccess = () => dismiss();
    if (target?.id) {
      mutations.updateEvent.mutate(
        { eventId: target.id, title: title.trim(), notes, eventDate, albumKey },
        { onSuccess },
      );
    } else {
      mutations.addEvent.mutate({ title: title.trim(), notes, eventDate, albumKey }, { onSuccess });
    }
  };

  return (
    <BottomSheetModal
      ref={ref}
      enableDynamicSizing
      backdropComponent={renderBackdrop}
      backgroundStyle={{ backgroundColor: theme.card }}
      handleIndicatorStyle={{ backgroundColor: theme.border }}
    >
      <BottomSheetScrollView contentContainerClassName="gap-4 px-5 pb-10 pt-2">
        <View className="flex-row items-center justify-between">
          <Text variant="subheading">
            {target?.id ? t('private.editPlan') : t('private.newPlan')}
          </Text>
          <AlbumDateField value={eventDate} onChange={setEventDate} />
        </View>

        <Input
          surface="bare"
          as={BottomSheetTextInput}
          value={title}
          onChangeText={setTitle}
          placeholder={t('private.planTitlePlaceholder')}
          style={{
            color: theme.foreground,
            borderWidth: 1,
            borderColor: theme.border,
            borderRadius: 14,
            paddingHorizontal: 14,
            paddingVertical: 10,
          }}
        />

        <Input
          surface="bare"
          as={BottomSheetTextInput}
          value={notes}
          onChangeText={setNotes}
          placeholder={t('private.planNotesPlaceholder')}
          multiline
          style={{
            color: theme.foreground,
            borderWidth: 1,
            borderColor: theme.border,
            borderRadius: 14,
            paddingHorizontal: 14,
            paddingVertical: 10,
            minHeight: 70,
            textAlignVertical: 'top',
          }}
        />

        <Button
          variant="accent"
          size="lg"
          label={t('common.save')}
          disabled={!title.trim()}
          onPress={save}
        />

        {target?.id ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              mutations.removeEvent.mutate(target.id!);
              dismiss();
            }}
            className="flex-row items-center justify-center gap-1.5 py-2"
          >
            <Trash2 size={14} color={theme.destructive} />
            <Text variant="caption" style={{ color: theme.destructive }}>
              {t('common.delete')}
            </Text>
          </Pressable>
        ) : null}
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
});
