import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetTextInput,
  BottomSheetView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import * as Haptics from 'expo-haptics';
import { Check } from 'lucide-react-native';
import { forwardRef, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { colors } from '@/constants/theme';
import {
  submitReport,
  type ReportReason,
  type ReportSurface,
} from '@/features/moderation/services/reports';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { toast } from '@/lib/toast-store';

/**
 * Reporting something somebody else wrote.
 *
 * `submitReport` and its server side (0013) have existed since the reports
 * migration and nothing ever called them, which meant the app had a complete
 * abuse pipeline and no way for a user to put anything into it. Both stores
 * require this for an app where users can reach each other, and more to the
 * point, a group whose only response to an abusive expense description is
 * "leave the group" is not one you would want somebody you know using.
 *
 * ## The evidence
 *
 * The report carries the item complained about, because the operator has no
 * other way to see it — for shared content there is nothing readable
 * server-side, and even for an expense group, reading somebody's group to
 * investigate is a far bigger intrusion than reading the one line they
 * objected to. The caller passes exactly that one item, and the copy says so
 * before the report is sent rather than after.
 *
 * The reporter is never shown to the reported party (0013's policies), which is
 * why this sheet does not warn about retaliation: there is nothing to warn
 * about, and saying "they won't be told it was you" is how you plant the idea
 * that they might be.
 */

const REASONS: ReportReason[] = ['harassment', 'sexual_content', 'spam', 'impersonation', 'other'];

export type ReportTarget = {
  /** Null when the item's author has since deleted their account — the report
   *  still has to be fileable, it just names a surface rather than a person. */
  reportedUserId: string | null;
  surface: ReportSurface;
  surfaceId: string | null;
  /** The one item complained about. Keep it to one — see submitReport. */
  evidence: Record<string, unknown>;
  /** What the user is looking at, echoed back so they can see they picked the
   *  thing they meant to. */
  label: string;
};

type Props = {
  target: ReportTarget | null;
  /** Offered after a successful report, when there is somebody to block. */
  onBlock?: (userId: string) => void;
};

export const ReportSheet = forwardRef<BottomSheetModal, Props>(function ReportSheet(
  { target, onBlock },
  ref,
) {
  const scheme = useColorScheme() ?? 'light';
  const theme = colors[scheme];
  const { t } = useTranslation();

  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);

  // A sheet reused for the next target must not open holding the last one's
  // answers — picking "harassment" about one thing and having it pre-selected
  // about the next is how a wrong report gets filed by accident.
  useEffect(() => {
    setReason(null);
    setNote('');
    setSending(false);
  }, [target?.surfaceId, target?.label]);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} opacity={0.4} />
    ),
    [],
  );

  const dismiss = () => {
    if (ref && 'current' in ref) ref.current?.dismiss();
  };

  const send = async () => {
    if (!target || reason === null || sending) return;
    setSending(true);

    const result = await submitReport({
      reportedUserId: target.reportedUserId,
      surface: target.surface,
      surfaceId: target.surfaceId,
      reason,
      note: note.trim() || undefined,
      evidence: target.evidence,
    });
    setSending(false);

    if (result.ok) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      toast.success(t('sharing.reportSent'));
      const blocked = target.reportedUserId;
      dismiss();
      // Offered here because this is the moment somebody knows they want it,
      // and making them find it in Settings afterwards is how it does not
      // happen. Never automatic: reporting spam is not the same decision as
      // never hearing from somebody again.
      if (blocked && onBlock) onBlock(blocked);
      return;
    }

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    // Rate-limiting is surfaced as itself. Reported as a generic failure it
    // reads as a bug, and the reply to a bug is to try again — which is
    // precisely what the limit is there to stop.
    toast.error(
      result.error === 'rate-limited' ? t('sharing.reportRateLimited') : t('errors.unknown'),
    );
  };

  return (
    <BottomSheetModal
      ref={ref}
      enableDynamicSizing
      backdropComponent={renderBackdrop}
      backgroundStyle={{ backgroundColor: theme.card }}
      handleIndicatorStyle={{ backgroundColor: theme.border }}
    >
      <BottomSheetView className="gap-4 px-5 pb-10 pt-2">
        <View className="gap-1">
          <Text variant="subheading">{t('sharing.reportTitle')}</Text>
          {target ? (
            <Text variant="caption" numberOfLines={2}>
              {target.label}
            </Text>
          ) : null}
        </View>

        <View className="rounded-2xl border border-border">
          {REASONS.map((option, index) => {
            const selected = reason === option;
            return (
              <Pressable
                key={option}
                onPress={() => {
                  Haptics.selectionAsync();
                  setReason(option);
                }}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={t(`sharing.reason_${option}`)}
                className={
                  index === 0
                    ? 'min-h-11 flex-row items-center gap-3 px-4 py-3'
                    : 'min-h-11 flex-row items-center gap-3 border-t border-border px-4 py-3'
                }
              >
                <Text className="flex-1 text-foreground">{t(`sharing.reason_${option}`)}</Text>
                {selected ? <Check size={18} color={theme.primary} /> : null}
              </Pressable>
            );
          })}
        </View>

        <Input
          surface="bare"
          as={BottomSheetTextInput}
          value={note}
          onChangeText={setNote}
          placeholder={t('sharing.reportNotePlaceholder')}
          multiline
          maxLength={500}
          accessibilityLabel={t('sharing.reportNotePlaceholder')}
          style={{
            minHeight: 72,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: theme.border,
            color: theme.foreground,
            paddingHorizontal: 14,
            paddingTop: 12,
            paddingBottom: 12,
            textAlignVertical: 'top',
          }}
        />

        {/* Said before sending, not after. What leaves the device is the whole
            question somebody hesitates over. */}
        <Text variant="caption">{t('sharing.reportEvidenceNote')}</Text>

        <Button
          label={sending ? t('common.saving') : t('sharing.reportSubmit')}
          onPress={() => void send()}
          disabled={reason === null || sending}
        />
      </BottomSheetView>
    </BottomSheetModal>
  );
});
